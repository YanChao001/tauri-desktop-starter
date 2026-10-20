import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { test } from "node:test";
import {
  BRANDING_ROOT,
  INSTALLER_IMAGES,
  INSTALLER_BITMAP_SCALE,
  brandingDifferences,
  encodeBitmap,
  normalizeMacIcon,
  normalizeWindowsIcon,
  planBranding,
  readBrandingSvg,
  renderBranding,
  writeBranding,
} from "./branding-lib.mjs";

test("BMP uses bottom-up BGR rows, padding and an opaque white alpha background", () => {
  const bitmap = encodeBitmap({
    width: 1,
    height: 2,
    pixels: Buffer.from([255, 0, 0, 255, 0, 0, 255, 0]),
  });
  assert.equal(bitmap.toString("ascii", 0, 2), "BM");
  assert.equal(bitmap.readUInt32LE(2), 62);
  assert.equal(bitmap.readUInt32LE(10), 54);
  assert.equal(bitmap.readUInt16LE(28), 24);
  assert.deepEqual([...bitmap.subarray(54)], [255, 255, 255, 0, 0, 0, 255, 0]);
  assert.throws(
    () => encodeBitmap({ width: 2, height: 2, pixels: Buffer.alloc(4) }),
    /dimensions/,
  );
});

test("installer vectors use their shared mark and keep WiX text regions white", () => {
  for (const { source, width, height } of INSTALLER_IMAGES) {
    const svg = readBrandingSvg(source);
    assert.doesNotMatch(svg, /<image|<text|href=/);
    const rendered = renderBranding(svg);
    const pixels = rendered.pixels;
    assert.equal(rendered.width, width);
    assert.equal(rendered.height, height);
    if (source === "installer-wix-dialog.svg") {
      for (let y = 0; y < height; y++) {
        for (let x = 164; x < width; x++) {
          assert.deepEqual(
            [...pixels.subarray((y * width + x) * 4, (y * width + x + 1) * 4)],
            [255, 255, 255, 255],
          );
        }
      }
    }
    if (source === "installer-wix-banner.svg") {
      for (let y = 0; y < 53; y++) {
        for (let x = 0; x < 426; x++) {
          assert.deepEqual(
            [...pixels.subarray((y * width + x) * 4, (y * width + x + 1) * 4)],
            [255, 255, 255, 255],
          );
        }
      }
    }
  }
});

test("branding sources cannot add fonts, remote files, raster images or recursive references", () => {
  const fixture = mkdtempSync(join(tmpdir(), "starter-branding-source-test-"));
  try {
    const source = join(fixture, "resources/branding");
    mkdirSync(source, { recursive: true });
    cpSync(join(BRANDING_ROOT, "resources/branding"), source, {
      recursive: true,
    });
    assert.throws(
      () => readBrandingSvg("../secrets.svg", fixture),
      /Unsupported/,
    );
    writeFileSync(
      join(source, "app-icon.svg"),
      '<svg><image href="https://example.com/a.png" x="0" y="0" width="1" height="1"/></svg>',
    );
    assert.throws(
      () => readBrandingSvg("app-icon.svg", fixture),
      /Unsupported/,
    );
    writeFileSync(
      join(source, "app-icon.svg"),
      '<svg><image href="app-icon.svg" x="0" y="0" width="1" height="1"/></svg>',
    );
    assert.throws(() => readBrandingSvg("app-icon.svg", fixture), /circular/);
    writeFileSync(
      join(source, "app-icon.svg"),
      "<svg><text>Font dependency</text></svg>",
    );
    assert.throws(
      () => readBrandingSvg("app-icon.svg", fixture),
      /self-contained/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("Tauri platform outputs retain all sizes and reproducible ICO/ICNS layers", () => {
  const plan = planBranding();
  const asset = (name) =>
    plan.find(({ path }) => basename(path) === name).contents;
  const ico = asset("icon.ico");
  for (const { target, width, height } of INSTALLER_IMAGES) {
    const bitmap = asset(target);
    assert.equal(bitmap.readInt32LE(18), width * INSTALLER_BITMAP_SCALE);
    assert.equal(bitmap.readInt32LE(22), height * INSTALLER_BITMAP_SCALE);
    assert.equal(bitmap.readUInt16LE(28), 24);
    assert.equal(bitmap.readUInt32LE(30), 0);
  }
  const sizes = Array.from(
    { length: ico.readUInt16LE(4) },
    (_, index) => ico[6 + index * 16] || 256,
  );
  assert.deepEqual(sizes, [32, 16, 24, 48, 64, 256]);
  assert.deepEqual(normalizeWindowsIcon(ico), ico);
  const icns = asset("icon.icns");
  const layers = new Map();
  for (let offset = 8; offset < icns.length;) {
    const length = icns.readUInt32BE(offset + 4);
    layers.set(
      icns.toString("ascii", offset, offset + 4),
      icns.subarray(offset + 8, offset + length),
    );
    offset += length;
  }
  for (const name of ["is32", "s8mk", "il32", "l8mk"])
    assert.ok(layers.has(name), name);
  for (const [name, size] of [
    ["ic11", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic13", 256],
    ["ic08", 256],
    ["ic14", 512],
    ["ic09", 512],
    ["ic10", 1024],
  ]) {
    const png = layers.get(name);
    assert.equal(png.readUInt32BE(16), size, name);
    assert.equal(png.readUInt32BE(20), size, name);
  }
  assert.deepEqual(normalizeMacIcon(icns), icns);
  for (const [name, size] of [
    ["32x32.png", 32],
    ["128x128.png", 128],
    ["128x128@2x.png", 256],
    ["icon.png", 512],
  ]) {
    const png = asset(name);
    assert.equal(png.readUInt32BE(16), size, name);
    assert.equal(png.readUInt32BE(20), size, name);
    assert.equal(png[24], 8, "8 bits per channel");
    assert.equal(png[25], 6, "RGBA");
  }
  const shuffled = Buffer.concat([
    icns.subarray(0, 8),
    ...[...layers].reverse().map(([name, data]) => {
      const header = Buffer.alloc(8);
      header.write(name);
      header.writeUInt32BE(data.length + 8, 4);
      return Buffer.concat([header, data]);
    }),
  ]);
  assert.deepEqual(normalizeMacIcon(shuffled), icns);
  const fixture = mkdtempSync(join(tmpdir(), "starter-branding-output-test-"));
  try {
    const copied = plan.map(({ path, contents }) => ({
      path: join(fixture, relative(BRANDING_ROOT, path)),
      contents,
    }));
    assert.equal(brandingDifferences(copied, fixture).length, 20);
    writeBranding(copied, fixture);
    assert.equal(brandingDifferences(copied, fixture).length, 0);
    writeFileSync(copied[0].path, "changed");
    rmSync(copied[1].path);
    assert.deepEqual(
      brandingDifferences(copied, fixture).map(({ path }) => basename(path)),
      ["32x32.png", "128x128.png"],
    );
    assert.equal(
      readFileSync(copied[0].path, "utf8"),
      "changed",
      "checking never rewrites files",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("branding validates every fixed target before creating or replacing outputs", () => {
  const fixture = mkdtempSync(join(tmpdir(), "starter-branding-target-test-"));
  try {
    const target = join(fixture, "src-tauri/icons/32x32.png");
    const unexpected = join(fixture, "README.md");
    mkdirSync(join(fixture, "src-tauri/icons"), { recursive: true });
    writeFileSync(target, "original");
    const plan = [
      { path: target, contents: Buffer.from("replacement") },
      { path: unexpected, contents: Buffer.from("unsupported") },
    ];
    assert.throws(
      () => brandingDifferences(plan, fixture),
      /Unsupported branding output/,
    );
    assert.throws(
      () => writeBranding(plan, fixture),
      /Unsupported branding output/,
    );
    assert.equal(readFileSync(target, "utf8"), "original");
    assert.equal(existsSync(unexpected), false);
    assert.throws(
      () => writeBranding([plan[0], plan[0]], fixture),
      /Duplicate branding output/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("branding refuses a directory junction before reading or writing any output", () => {
  const fixture = mkdtempSync(
    join(tmpdir(), "starter-branding-junction-test-"),
  );
  const outside = mkdtempSync(join(tmpdir(), "starter-branding-outside-test-"));
  try {
    mkdirSync(join(fixture, "src-tauri/installer"), { recursive: true });
    symlinkSync(
      outside,
      join(fixture, "src-tauri/icons"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const original = join(fixture, "src-tauri/installer/header.bmp");
    writeFileSync(original, "original installer");
    writeFileSync(join(outside, "32x32.png"), "outside icon");
    const plan = [
      { path: original, contents: Buffer.from("new installer") },
      {
        path: join(fixture, "src-tauri/icons/32x32.png"),
        contents: Buffer.from("new icon"),
      },
    ];
    assert.throws(() => brandingDifferences(plan, fixture), /real directory/);
    assert.throws(() => writeBranding(plan, fixture), /real directory/);
    assert.equal(readFileSync(original, "utf8"), "original installer");
    assert.equal(
      readFileSync(join(outside, "32x32.png"), "utf8"),
      "outside icon",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("branding refuses a leaf symbolic link without reading or replacing its target", (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "starter-branding-symlink-test-"));
  const outside = mkdtempSync(
    join(tmpdir(), "starter-branding-link-target-test-"),
  );
  try {
    mkdirSync(join(fixture, "src-tauri/icons"), { recursive: true });
    const source = join(outside, "original.png");
    const target = join(fixture, "src-tauri/icons/32x32.png");
    writeFileSync(source, "outside icon");
    try {
      symlinkSync(source, target, "file");
    } catch (error) {
      if (
        process.platform === "win32" &&
        ["EPERM", "EACCES"].includes(error.code)
      ) {
        context.skip(
          "Windows file symlinks require Developer Mode or symlink privileges",
        );
        return;
      }
      throw error;
    }
    const plan = [{ path: target, contents: Buffer.from("replacement") }];
    assert.throws(() => brandingDifferences(plan, fixture), /regular file/);
    assert.throws(() => writeBranding(plan, fixture), /regular file/);
    assert.equal(readFileSync(source, "utf8"), "outside icon");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("branding replaces a hardlinked output without mutating the other file", () => {
  const fixture = mkdtempSync(
    join(tmpdir(), "starter-branding-hardlink-test-"),
  );
  try {
    mkdirSync(join(fixture, "src-tauri/icons"), { recursive: true });
    const source = join(fixture, "original.png");
    const target = join(fixture, "src-tauri/icons/32x32.png");
    writeFileSync(source, "original bytes");
    linkSync(source, target);
    writeBranding(
      [{ path: target, contents: Buffer.from("new bytes") }],
      fixture,
    );
    assert.equal(readFileSync(target, "utf8"), "new bytes");
    assert.equal(readFileSync(source, "utf8"), "original bytes");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { Resvg } from "@resvg/resvg-js";
import {
  updateReadmePreviews,
  validateReadmePreviews,
} from "./readme-previews.mjs";

const FILES = [
  ["desktop-light.png", "preview-light.png"],
  ["desktop-dark.png", "preview-dark.png"],
  ["desktop-skins-dark.png", "skins-dark.png"],
];

function png(fill, width = 1280, height = 840) {
  return new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`,
  )
    .render()
    .asPng();
}
const OLD = png("#ffffff");
const LIGHT = png("#e8faf4");
const DARK = png("#171717");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-readme-previews-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "artifacts/e2e/previews"), { recursive: true });
  mkdirSync(join(root, "docs/assets"), { recursive: true });
  for (const [index, [source, destination]] of FILES.entries()) {
    writeFileSync(
      join(root, "artifacts/e2e/previews", source),
      index ? DARK : LIGHT,
    );
    writeFileSync(join(root, "docs/assets", destination), OLD);
  }
  return root;
}

function images(root) {
  return FILES.map(([, destination]) =>
    readFileSync(join(root, "docs/assets", destination)),
  );
}

test("sync updates only the documented images and leaves matching files untouched", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "docs/assets/unrelated.png"), OLD);
  assert.deepEqual(
    updateReadmePreviews(root),
    FILES.map(([, destination]) => `docs/assets/${destination}`),
  );
  assert.deepEqual(images(root), [LIGHT, DARK, DARK]);
  assert.deepEqual(readFileSync(join(root, "docs/assets/unrelated.png")), OLD);
  const modified = FILES.map(
    ([, name]) => lstatSync(join(root, "docs/assets", name)).mtimeMs,
  );
  assert.deepEqual(updateReadmePreviews(root), []);
  assert.deepEqual(
    FILES.map(([, name]) => lstatSync(join(root, "docs/assets", name)).mtimeMs),
    modified,
  );
  assert.deepEqual(updateReadmePreviews(root, { check: true }), []);
});

test("check reports stale previews without writing them", (t) => {
  const root = fixture(t);
  const before = images(root);
  assert.throws(
    () => updateReadmePreviews(root, { check: true }),
    /docs:previews/,
  );
  assert.deepEqual(images(root), before);
});

test("missing, truncated, non-PNG and undersized inputs leave every preview unchanged", (t) => {
  for (const invalid of [
    undefined,
    DARK.subarray(0, -8),
    Buffer.from("not a screenshot"),
    png("#000", 128, 84),
  ]) {
    const root = fixture(t);
    const path = join(root, "artifacts/e2e/previews/desktop-skins-dark.png");
    if (invalid === undefined) unlinkSync(path);
    else writeFileSync(path, invalid);
    assert.throws(() => updateReadmePreviews(root), /缺少截图|完整的 PNG|尺寸/);
    assert.deepEqual(images(root), [OLD, OLD, OLD]);
  }
});

test("light and dark captures must use the same window size", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "artifacts/e2e/previews/desktop-dark.png"),
    png("#000", 1024, 768),
  );
  assert.throws(() => updateReadmePreviews(root), /窗口尺寸不一致/);
  assert.deepEqual(images(root), [OLD, OLD, OLD]);
});

test("committed image validation works without captures and never writes files", (t) => {
  const root = fixture(t);
  unlinkSync(join(root, "artifacts/e2e/previews/desktop-light.png"));
  const before = images(root);
  const modified = FILES.map(
    ([, name]) => lstatSync(join(root, "docs/assets", name)).mtimeMs,
  );
  validateReadmePreviews(root);
  assert.deepEqual(images(root), before);
  assert.deepEqual(
    FILES.map(([, name]) => lstatSync(join(root, "docs/assets", name)).mtimeMs),
    modified,
  );
});

test("committed image validation rejects missing, invalid and mismatched images", (t) => {
  for (const invalid of [
    undefined,
    DARK.subarray(0, -8),
    Buffer.from("not PNG"),
    png("#000", 128, 84),
    png("#000", 1024, 768),
  ]) {
    const root = fixture(t);
    const path = join(root, "docs/assets/preview-dark.png");
    if (invalid === undefined) unlinkSync(path);
    else writeFileSync(path, invalid);
    assert.throws(
      () => validateReadmePreviews(root),
      /缺少截图|完整的 PNG|尺寸/,
    );
    assert.deepEqual(
      readFileSync(join(root, "docs/assets/preview-light.png")),
      OLD,
    );
  }
});

test("sync rejects destination directory links outside the project", (t) => {
  const root = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "starter-readme-outside-"));
  t.after(() => {
    assert.equal(dirname(outside), resolve(tmpdir()));
    rmSync(outside, { recursive: true, force: true });
  });
  for (const [, name] of FILES) writeFileSync(join(outside, name), OLD);
  rmSync(join(root, "docs/assets"), { recursive: true });
  symlinkSync(
    outside,
    join(root, "docs/assets"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => updateReadmePreviews(root), /项目外文件/);
  for (const [, name] of FILES)
    assert.deepEqual(readFileSync(join(outside, name)), OLD);
});

test("CLI rejects unknown arguments and explains missing captures without starting an app", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "scripts"));
  for (const name of ["readme-previews.mjs", "fs-utils.mjs"])
    copyFileSync(new URL(name, import.meta.url), join(root, "scripts", name));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [join(root, "scripts/readme-previews.mjs"), ...args],
      { encoding: "utf8" },
    );
  assert.equal(run("--help").status, 0);
  assert.equal(run("--typo").status, 1);
  assert.equal(run("--check", "--validate").status, 1);
  unlinkSync(join(root, "artifacts/e2e/previews/desktop-dark.png"));
  const validation = run("--validate");
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /检查通过/);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少截图/);
  assert.deepEqual(images(root), [OLD, OLD, OLD]);
});

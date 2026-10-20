import { Resvg } from "@resvg/resvg-js";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
export const BRANDING_ROOT = resolve(import.meta.dirname, "..");
const ICON_FILES = Object.freeze([
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
]);
export const INSTALLER_IMAGES = Object.freeze([
  {
    source: "installer-header.svg",
    target: "header.bmp",
    width: 150,
    height: 57,
  },
  {
    source: "installer-sidebar.svg",
    target: "sidebar.bmp",
    width: 164,
    height: 314,
  },
  {
    source: "installer-wix-banner.svg",
    target: "wix-banner.bmp",
    width: 493,
    height: 58,
  },
  {
    source: "installer-wix-dialog.svg",
    target: "wix-dialog.bmp",
    width: 493,
    height: 312,
  },
]);
// 位图直接由矢量以三倍分辨率渲染，避免高 DPI 显示时放大低分辨率图像。
export const INSTALLER_BITMAP_SCALE = 3;
const sourceNames = new Set([
  "app-icon.svg",
  ...INSTALLER_IMAGES.map(({ source }) => source),
]);
const outputNames = new Set([
  ...ICON_FILES.map((name) => `src-tauri/icons/${name}`),
  ...INSTALLER_IMAGES.map(({ target }) => `src-tauri/installer/${target}`),
]);

function outputContext(root) {
  const declaredRoot = resolve(root);
  const realRoot = realpathSync(declaredRoot);
  if (!lstatSync(realRoot).isDirectory()) {
    throw new Error("Branding root must be a directory");
  }
  return { declaredRoot, realRoot };
}

function inspectPath(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** 校验输出路径的祖先目录，防止链接将固定文件名重定向到其他位置。 */
function assertOutputParent(context, path) {
  const offset = relative(context.realRoot, dirname(path));
  let current = context.realRoot;
  for (const component of offset.split(sep).filter(Boolean)) {
    current = join(current, component);
    const stat = inspectPath(current);
    if (!stat) break;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `Branding output parent must be a real directory: ${current}`,
      );
    }
    if (realpathSync(current) !== current) {
      throw new Error(
        `Branding output parent resolves outside its path: ${current}`,
      );
    }
  }
}

function assertOutput(context, entry) {
  if (typeof entry?.path !== "string" || !Buffer.isBuffer(entry.contents)) {
    throw new Error("Invalid branding output entry");
  }
  const name = [context.declaredRoot, context.realRoot]
    .map((root) => relative(root, resolve(entry.path)).split(sep).join("/"))
    .find((name) => outputNames.has(name));
  if (!name) {
    throw new Error(`Unsupported branding output: ${entry.path}`);
  }
  const path = join(context.realRoot, name);
  assertOutputParent(context, path);
  const stat = inspectPath(path);
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
    throw new Error(`Branding output must be a regular file: ${path}`);
  }
  return { ...entry, path };
}

function validateOutputs(plan, root) {
  if (!Array.isArray(plan)) throw new Error("Invalid branding output plan");
  const context = outputContext(root);
  const entries = plan.map((entry) => assertOutput(context, entry));
  if (new Set(entries.map(({ path }) => path)).size !== entries.length) {
    throw new Error("Duplicate branding output target");
  }
  return { context, entries };
}

/** 仅内联项目内的矢量源，不引入字体、位图或网络依赖。 */
export function readBrandingSvg(name, root = BRANDING_ROOT, ancestors = []) {
  if (!sourceNames.has(name) || ancestors.includes(name)) {
    throw new Error(`Unsupported or circular branding source: ${name}`);
  }
  const source = readFileSync(join(root, "resources/branding", name), "utf8");
  if (
    /<(?:script|foreignObject|text)\b|\bon\w+\s*=|url\(\s*[^#]|<!DOCTYPE|<!ENTITY/i.test(
      source,
    )
  ) {
    throw new Error(
      `Branding SVG must contain self-contained vector artwork: ${name}`,
    );
  }
  let index = 0;
  const result = source.replace(
    /<image\b([^>]*?)\s*\/>/g,
    (_match, attributes) => {
      const values = Object.fromEntries(
        [...attributes.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );
      const nested = readBrandingSvg(values.href, root, [...ancestors, name]);
      const content = nested.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/)?.[1];
      const viewBox = nested.match(/\bviewBox="([^"]+)"/)?.[1];
      if (
        !content ||
        !viewBox ||
        ![values.x, values.y, values.width, values.height].every((value) =>
          /^\d+(?:\.\d+)?$/.test(value),
        )
      ) {
        throw new Error(`Invalid branding image placement in ${name}`);
      }
      const prefix = `${name.replace(/\W/g, "-")}-${index++}-`;
      const scoped = content
        .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`);
      return `<svg x="${values.x}" y="${values.y}" width="${values.width}" height="${values.height}" viewBox="${viewBox}" fill="none">${scoped}</svg>`;
    },
  );
  if (/<image\b|\b(?:href|xlink:href)\s*=/i.test(result)) {
    throw new Error(`Unresolved external branding reference in ${name}`);
  }
  return result;
}

export function renderBranding(svg, width) {
  return new Resvg(svg, {
    ...(width ? { fitTo: { mode: "width", value: width } } : {}),
    font: { loadSystemFonts: false },
  }).render();
}

/** Windows 安装器使用未压缩、像素行自下而上排列的 24 位 BGR 位图。 */
export function encodeBitmap({ width, height, pixels }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height * 4
  ) {
    throw new Error("Invalid RGBA bitmap dimensions");
  }
  const stride = (width * 3 + 3) & ~3;
  const file = Buffer.alloc(54 + stride * height);
  file.write("BM");
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(stride * height, 34);
  file.writeInt32LE(3780, 38);
  file.writeInt32LE(3780, 42);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const target = 54 + (height - y - 1) * stride + x * 3;
      const alpha = pixels[source + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        file[target + channel] = Math.round(
          pixels[source + 2 - channel] * alpha + 255 * (1 - alpha),
        );
      }
    }
  }
  return file;
}

/** 将 32 像素图层置于 ICO 目录首位，保留 Tauri 生成的各层图像数据。 */
export function normalizeWindowsIcon(contents) {
  const normalized = Buffer.from(contents);
  const count = contents.readUInt16LE(4);
  if (
    contents.readUInt16LE(0) !== 0 ||
    contents.readUInt16LE(2) !== 1 ||
    count !== 6
  ) {
    throw new Error("Tauri generated an unsupported Windows icon directory");
  }
  const priority = [32, 16, 24, 48, 64, 256];
  const entries = Array.from({ length: count }, (_, index) => {
    const entry = contents.subarray(6 + index * 16, 22 + index * 16);
    return { entry, size: entry[0] || 256 };
  });
  if (
    new Set(entries.map(({ size }) => size)).size !== priority.length ||
    entries.some(({ size }) => !priority.includes(size))
  ) {
    throw new Error("Tauri Windows icon is missing a required size");
  }
  entries.sort(
    (left, right) => priority.indexOf(left.size) - priority.indexOf(right.size),
  );
  entries.forEach(({ entry }, index) => entry.copy(normalized, 6 + index * 16));
  return normalized;
}

/** Tauri 的 ICNS 编码器遍历 HashMap，需排序图层以保证输出可复现。 */
export function normalizeMacIcon(contents) {
  if (
    contents.toString("ascii", 0, 4) !== "icns" ||
    contents.readUInt32BE(4) !== contents.length
  ) {
    throw new Error("Tauri generated an invalid macOS icon");
  }
  const chunks = [];
  for (let offset = 8; offset < contents.length;) {
    if (offset + 8 > contents.length) throw new Error("Truncated macOS icon");
    const size = contents.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > contents.length)
      throw new Error("Invalid macOS icon layer");
    chunks.push(contents.subarray(offset, offset + size));
    offset += size;
  }
  chunks.sort((left, right) =>
    Buffer.compare(left.subarray(0, 4), right.subarray(0, 4)),
  );
  return Buffer.concat([contents.subarray(0, 8), ...chunks]);
}

/** 先在临时目录生成完整结果，再更新仓库中的资源。 */
export function planBranding(root = BRANDING_ROOT) {
  const temporary = mkdtempSync(join(tmpdir(), "starter-branding-"));
  try {
    const icon = readBrandingSvg("app-icon.svg", root);
    const input = join(temporary, "app-icon.svg");
    const output = join(temporary, "icons");
    writeFileSync(input, icon);
    // 使用 Tauri 维护的 ICO / ICNS 编码器生成各平台所需的全部图层。
    const generated = spawnSync(
      process.execPath,
      [
        require.resolve("@tauri-apps/cli/tauri.js"),
        "icon",
        input,
        "--output",
        output,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000 },
    );
    if (generated.error || generated.status !== 0) {
      throw new Error(
        `Tauri icon generation failed: ${generated.error?.message ?? generated.stderr ?? generated.stdout}`,
      );
    }
    const plan = ICON_FILES.map((name) => {
      const contents = readFileSync(join(output, name));
      return {
        path: join(root, "src-tauri/icons", name),
        contents:
          name === "icon.ico"
            ? normalizeWindowsIcon(contents)
            : name === "icon.icns"
              ? normalizeMacIcon(contents)
              : contents,
      };
    });
    for (const { source, target, width, height } of INSTALLER_IMAGES) {
      const svg = readBrandingSvg(source, root);
      const logical = renderBranding(svg);
      if (logical.width !== width || logical.height !== height) {
        throw new Error(`${source} must remain ${width} × ${height}`);
      }
      const rendered = renderBranding(svg, width * INSTALLER_BITMAP_SCALE);
      plan.push({
        path: join(root, "src-tauri/installer", target),
        contents: encodeBitmap(rendered),
      });
    }
    return plan;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function brandingDifferences(plan, root = BRANDING_ROOT) {
  const { context, entries } = validateOutputs(plan, root);
  return entries.filter((entry) => {
    const { path, contents } = assertOutput(context, entry);
    try {
      return !readFileSync(path).equals(contents);
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    }
  });
}

export function writeBranding(plan, root = BRANDING_ROOT) {
  const { context, entries } = validateOutputs(plan, root);
  const staged = [];
  try {
    for (const entry of entries) {
      const { path, contents } = assertOutput(context, entry);
      mkdirSync(dirname(path), { recursive: true });
      assertOutput(context, entry);
      const temporary = join(
        dirname(path),
        `.${basename(path)}.branding-${randomUUID()}.tmp`,
      );
      const descriptor = openSync(temporary, "wx");
      staged.push({ entry, temporary });
      try {
        writeFileSync(descriptor, contents);
      } finally {
        closeSync(descriptor);
      }
    }
    // 替换首个输出文件前，再次校验整批目标。
    for (const { entry } of staged) assertOutput(context, entry);
    for (const { entry, temporary } of staged) {
      const { path } = assertOutput(context, entry);
      renameSync(temporary, path);
    }
  } finally {
    for (const { temporary } of staged) {
      try {
        assertOutputParent(context, temporary);
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.warn(
            `Branding temporary file retained: ${temporary} (${error.message})`,
          );
        }
      }
    }
  }
}

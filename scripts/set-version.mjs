#!/usr/bin/env node
/**
 * 同步三处版本号：package.json、tauri.conf.json、Cargo.toml（以及 Cargo.lock 中的自身条目）。
 *
 * 用法：pnpm version:set 1.2.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const root = join(import.meta.dirname, "..");

const next = process.argv[2];
if (!next || !SEMVER.test(next)) {
  console.error("用法: pnpm version:set <x.y.z>");
  console.error("示例: pnpm version:set 1.2.0");
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function write(relativePath, content) {
  writeFileSync(join(root, relativePath), content, "utf8");
}

function bumpJson(relativePath) {
  const data = JSON.parse(read(relativePath));
  const previous = data.version;
  data.version = next;
  write(relativePath, `${JSON.stringify(data, null, 2)}\n`);
  return previous;
}

function bumpCargoToml() {
  const lines = read("src-tauri/Cargo.toml").split("\n");
  let inPackage = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("[")) {
      inPackage = line === "[package]";
      continue;
    }
    if (inPackage && /^version\s*=\s*".*"$/.test(line)) {
      const previous = line.match(/"([^"]+)"/)?.[1] ?? "unknown";
      lines[index] = `version = "${next}"`;
      write("src-tauri/Cargo.toml", lines.join("\n"));
      return previous;
    }
  }
  throw new Error("Cargo.toml 里没有找到 [package] version");
}

function bumpCargoLock(packageName) {
  let content;
  try {
    content = read("src-tauri/Cargo.lock");
  } catch {
    return;
  }
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== `name = "${packageName}"`) continue;
    for (
      let cursor = index + 1;
      cursor < Math.min(index + 4, lines.length);
      cursor += 1
    ) {
      if (/^version = "/.test(lines[cursor].trim())) {
        lines[cursor] = lines[cursor].replace(
          /version = ".*"/,
          `version = "${next}"`,
        );
        write("src-tauri/Cargo.lock", lines.join("\n"));
        return;
      }
    }
  }
}

const packageName = JSON.parse(read("package.json")).name;
const previousPackage = bumpJson("package.json");
bumpJson("src-tauri/tauri.conf.json");
bumpCargoToml();
bumpCargoLock(packageName);

console.log(`版本号已更新: ${previousPackage} -> ${next}`);
console.log("  package.json");
console.log("  src-tauri/tauri.conf.json");
console.log("  src-tauri/Cargo.toml");
console.log("  src-tauri/Cargo.lock（如存在）");
console.log("\n下一步：更新 CHANGELOG.md，然后提交并打 tag。");

#!/usr/bin/env node
/**
 * 清理构建产物。
 *
 * 仅清理预定义目录，不接受任意路径，避免参数错误导致误删。
 */
import { resolve } from "node:path";
import { removeProjectPath } from "./fs-utils.mjs";

const ROOT = resolve(import.meta.dirname, "..");

const DISTRIBUTIONS = [["artifacts", "按版本归档的分发产物"]];

const BUILD_OUTPUT = [
  ["dist", "前端构建产物"],
  ["dist-web", "浏览器演示构建产物"],
  ...DISTRIBUTIONS,
  ["dist-portable", "旧版便携产物（兼容清理）"],
  ["coverage", "测试覆盖率报告"],
  ["src-tauri/target", "Rust 编译缓存（通常 1 GB 以上）"],
];

const DEPENDENCIES = [["node_modules", "依赖目录"]];

/** 文件被占用时，输出具体的处理建议。 */
const HINTS = {
  EBUSY: "目录被占用，先关掉 dev server、预览窗口，或者正在扫描它的杀毒软件",
  EPERM: "没有权限，检查是否有进程以管理员身份占着这些文件",
  EACCES: "没有权限，检查目录属主",
  ENOTEMPTY: "目录里还有文件没删掉，重试一次通常就好",
};

const all = process.argv.includes("--all");
const artifactsOnly = process.argv.includes("--artifacts");
if (
  (all && artifactsOnly) ||
  process.argv.slice(2).some((arg) => arg !== "--all" && arg !== "--artifacts")
) {
  console.error("用法: pnpm clean [--all | --artifacts]；不接受自定义路径");
  process.exit(1);
}
const targets = artifactsOnly
  ? DISTRIBUTIONS
  : all
    ? [...BUILD_OUTPUT, ...DEPENDENCIES]
    : BUILD_OUTPUT;

let removed = 0;
const failed = [];

for (const [relative, label] of targets) {
  try {
    if (removeProjectPath(ROOT, relative)) {
      console.log(`已删除 ${relative.padEnd(20)} ${label}`);
      removed += 1;
    } else {
      console.log(`跳过 ${relative}（不存在）`);
    }
  } catch (error) {
    const code = error.code ?? "UNKNOWN";
    console.error(
      `失败   ${relative.padEnd(20)} ${HINTS[code] ?? error.message}`,
    );
    failed.push(relative);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} 个目录没能删除：${failed.join("、")}`);
  process.exitCode = 1;
} else if (removed === 0) {
  console.log("\n没有需要清理的内容。");
} else if (all) {
  console.log("\n完成。依赖已删除，下一步执行 pnpm install。");
} else if (artifactsOnly) {
  console.log("\n完成。分发产物已清理，编译缓存与依赖已保留。");
} else {
  console.log("\n完成。下次构建会自动重建。");
}

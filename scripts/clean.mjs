#!/usr/bin/env node
/**
 * 清理构建产物。
 *
 * 只删这张固定列表里的目录，不接受命令行传入路径——
 * 一个能删任意路径的清理脚本，迟早会被写成 `rm -rf $1` 然后闯祸。
 */
import { resolve } from "node:path";
import { removeProjectPath } from "./fs-utils.mjs";

const ROOT = resolve(import.meta.dirname, "..");

const BUILD_OUTPUT = [
  ["dist", "前端构建产物"],
  ["dist-portable", "便携版产物"],
  ["coverage", "测试覆盖率报告"],
  ["src-tauri/target", "Rust 编译缓存（通常 1 GB 以上）"],
];

const DEPENDENCIES = [["node_modules", "依赖目录"]];

/** 文件被占用时给一句能照做的话，而不是甩一串堆栈。 */
const HINTS = {
  EBUSY: "目录被占用，先关掉 dev server、预览窗口，或者正在扫描它的杀毒软件",
  EPERM: "没有权限，检查是否有进程以管理员身份占着这些文件",
  EACCES: "没有权限，检查目录属主",
  ENOTEMPTY: "目录里还有文件没删掉，重试一次通常就好",
};

const all = process.argv.includes("--all");
if (process.argv.slice(2).some((arg) => arg !== "--all")) {
  console.error("用法: pnpm clean [--all]；不接受自定义路径");
  process.exit(1);
}
const targets = all ? [...BUILD_OUTPUT, ...DEPENDENCIES] : BUILD_OUTPUT;

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
} else {
  console.log("\n完成。下次构建会自动重建。");
}

#!/usr/bin/env node
/**
 * 清理构建产物。
 *
 * 仅清理预定义范围，不接受任意路径，避免参数错误导致误删。
 */
import { resolve } from "node:path";
import { removeProjectPath } from "./fs-utils.mjs";
import {
  assertNoRunningPrograms,
  cleanupTargets,
  getWindowsProcesses,
  parseCleanupArgs,
  validateCleanupTarget,
} from "./clean-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");

/** 文件被占用时，输出具体的处理建议。 */
const HINTS = {
  EBUSY: "目录被占用，先关掉 dev server、预览窗口，或者正在扫描它的杀毒软件",
  EPERM: "没有权限，检查是否有进程以管理员身份占着这些文件",
  EACCES: "没有权限，检查目录属主",
  ENOTEMPTY: "目录里还有文件没删掉，重试一次通常就好",
};

let options;
let targets;
let processes = [];
let validation;
try {
  options = parseCleanupArgs(process.argv.slice(2));
  validation = { allowFile: options.mode === "outputs" };
  // 全部目标在删除前解析并核对；预览复用同一份计划与保护。
  targets = cleanupTargets(ROOT, options.mode).map(([path, label]) => ({
    path,
    label,
    absolute: validateCleanupTarget(ROOT, path, validation),
  }));
  if (process.platform === "win32" && targets.some((target) => target.absolute))
    processes = getWindowsProcesses();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (options.dryRun) console.log("预览模式：不会删除任何文件。");

let removed = 0;
const failed = [];

for (const { path, label, absolute } of targets) {
  try {
    if (!absolute) {
      console.log(`跳过 ${path}（不存在）`);
      continue;
    }
    assertNoRunningPrograms(absolute, processes);
    if (options.dryRun) {
      console.log(`将删除 ${path.padEnd(20)} ${label}`);
      continue;
    }
    // 删除前再次核对，再由共用 helper 执行受控递归删除。
    validateCleanupTarget(ROOT, path, validation);
    if (removeProjectPath(ROOT, path)) {
      console.log(`已删除 ${path.padEnd(20)} ${label}`);
      removed += 1;
    } else {
      console.log(`跳过 ${path}（不存在）`);
    }
  } catch (error) {
    const code = error.code ?? "UNKNOWN";
    console.error(`失败   ${path.padEnd(20)} ${HINTS[code] ?? error.message}`);
    failed.push(path);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} 个清理目标没能删除：${failed.join("、")}`);
  process.exitCode = 1;
} else if (options.dryRun) {
  console.log("\n预览完成。移除 --dry-run 后执行相同模式。");
} else if (removed === 0) {
  console.log("\n没有需要清理的内容。");
} else if (options.mode === "all") {
  console.log("\n完成。依赖已删除，下一步执行 pnpm install。");
} else if (options.mode === "artifacts") {
  console.log("\n完成。分发产物已清理，编译缓存与依赖已保留。");
} else if (options.mode === "temporary") {
  console.log("\n完成。正式版本分发与实际依赖已保留。");
} else if (options.mode === "outputs") {
  console.log(
    "\nDone. Compilation caches, build tools and dependencies have been retained.",
  );
} else {
  console.log("\n完成。下次构建会自动重建。");
}

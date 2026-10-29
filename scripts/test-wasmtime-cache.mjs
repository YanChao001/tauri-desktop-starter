#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildEnvironment } from "./build-lib.mjs";

if (process.argv.length > 2) {
  throw new Error("Usage: node scripts/test-wasmtime-cache.mjs");
}

const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "starter-wasmtime-cache-"));
if (dirname(directory) !== resolve(tmpdir())) {
  throw new Error("Invalid Wasmtime cache test temporary directory");
}

try {
  cpSync(join(root, "src-tauri/vendor/wasmtime-internal-cache"), directory, {
    recursive: true,
  });
  // 沿用生产解析的版本，仅在临时锁文件中补齐上游测试依赖。
  copyFileSync(
    join(root, "src-tauri/Cargo.lock"),
    join(directory, "Cargo.lock"),
  );
  console.log("Testing the patched Wasmtime cache in an isolated source copy.");
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      join(directory, "Cargo.toml"),
      "--target-dir",
      join(root, "src-tauri/target"),
      "--lib",
      "--tests",
    ],
    {
      // 从仓库根目录选择 rustup 工具链，不继承临时目录的默认工具链。
      cwd: root,
      env: buildEnvironment(),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  // 只清理 mkdtemp 创建且已核对父目录的副本，不删除共享编译缓存。
  rmSync(directory, { recursive: true, force: true });
}

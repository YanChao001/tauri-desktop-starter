#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { format } from "prettier";
import { buildEnvironment } from "./build-lib.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check") || args.length > 1) {
  throw new Error("Usage: node scripts/generate-bindings.mjs [--check]");
}
const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "tauri-bindings-"));
if (dirname(directory) !== resolve(tmpdir()))
  throw new Error("Invalid bindings temporary directory");
try {
  const output = join(directory, "bindings.ts");
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--manifest-path",
      join(root, "src-tauri/Cargo.toml"),
      "--locked",
      "--features",
      "bindings",
      "--bin",
      "export-bindings",
      "--",
      output,
    ],
    {
      cwd: root,
      env: buildEnvironment(),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    const target = join(root, "src/lib/generated/bindings.ts");
    const generated = await format(readFileSync(output, "utf8"), {
      filepath: target,
    });
    if (args.includes("--check")) {
      if (readFileSync(target, "utf8") !== generated) {
        console.error(
          "Rust IPC bindings changed. Run pnpm bindings:generate and commit the result.",
        );
        process.exitCode = 1;
      } else console.log("Rust IPC bindings are current.");
    } else {
      writeFileSync(target, generated, "utf8");
      console.log(
        "Generated src/lib/generated/bindings.ts from Rust commands.",
      );
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { removeProjectPath } from "./fs-utils.mjs";

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "tauri-clean-test-"));
  t.after(() => {
    assert.equal(dirname(base), resolve(tmpdir()));
    rmSync(base, { recursive: true, force: true });
  });
  const root = join(base, "project");
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const name of ["clean.mjs", "fs-utils.mjs"]) {
    copyFileSync(new URL(name, import.meta.url), join(root, "scripts", name));
  }
  for (const path of [
    "dist",
    "artifacts",
    "coverage",
    "dist-portable",
    "src-tauri/target",
    "node_modules",
  ]) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "artifact"), "keep until cleaned");
  }
  return { base, root };
}

test("clean removes generated output and only removes dependencies with --all", (t) => {
  const { root } = fixture(t);
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, "scripts/clean.mjs"), ...args], {
      encoding: "utf8",
    });
  assert.equal(run("--typo").status, 1);
  assert.equal(existsSync(join(root, "dist/artifact")), true);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const path of [
    "dist",
    "artifacts",
    "coverage",
    "dist-portable",
    "src-tauri/target",
  ]) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
  assert.equal(existsSync(join(root, "node_modules/artifact")), true);
  assert.equal(run("--all").status, 0);
  assert.equal(existsSync(join(root, "node_modules")), false);
});

test("--artifacts only removes current distributions and preserves legacy output and caches", (t) => {
  const { root } = fixture(t);
  const versioned = join(root, "artifacts/0.1.0/windows-x64");
  mkdirSync(versioned, { recursive: true });
  writeFileSync(join(versioned, "app.exe"), "versioned distribution");
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/clean.mjs"), "--artifacts"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(root, "artifacts")), false);
  for (const path of [
    "dist",
    "dist-portable",
    "coverage",
    "src-tauri/target",
    "node_modules",
  ]) {
    assert.equal(existsSync(join(root, path, "artifact")), true, path);
  }
});

test("mutually exclusive cleanup modes fail before deleting any output", (t) => {
  const { root } = fixture(t);
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/clean.mjs"), "--all", "--artifacts"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  for (const path of [
    "dist",
    "artifacts",
    "dist-portable",
    "coverage",
    "src-tauri/target",
    "node_modules",
  ]) {
    assert.equal(existsSync(join(root, path, "artifact")), true, path);
  }
});

test("cleanup rejects the project root, traversal and ancestor junction escapes", (t) => {
  const { base, root } = fixture(t);
  const outside = join(base, "outside");
  mkdirSync(join(outside, "target"), { recursive: true });
  writeFileSync(join(outside, "target/keep"), "outside data");
  assert.throws(() => removeProjectPath(root, "."), /拒绝/);
  assert.throws(() => removeProjectPath(root, "../outside"), /拒绝/);
  symlinkSync(
    outside,
    join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => removeProjectPath(root, "linked/target"), /拒绝/);
  assert.equal(existsSync(join(outside, "target/keep")), true);
  assert.equal(removeProjectPath(root, "linked"), true);
  assert.equal(existsSync(join(outside, "target/keep")), true);
});

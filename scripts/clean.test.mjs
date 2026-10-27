import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { assertNoRunningPrograms, getWindowsProcesses } from "./clean-lib.mjs";
import { removeProjectPath } from "./fs-utils.mjs";

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "tauri-clean-test-"));
  t.after(() => {
    assert.equal(dirname(base), resolve(tmpdir()));
    rmSync(base, { recursive: true, force: true });
  });
  const root = join(base, "project");
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const name of ["clean.mjs", "clean-lib.mjs", "fs-utils.mjs"]) {
    copyFileSync(new URL(name, import.meta.url), join(root, "scripts", name));
  }
  for (const path of [
    "dist",
    "dist-web",
    "artifacts",
    "coverage",
    "src-tauri/target",
    "src-tauri/gen/schemas",
    "node_modules",
  ]) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "artifact"), "keep until cleaned");
  }
  return { base, root };
}

function runCleanup(root, ...args) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts/clean.mjs"), ...args],
    { encoding: "utf8" },
  );
}

function put(root, path, contents = "fixture data") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function snapshot(root) {
  const entries = [];
  const visit = (relative = "") => {
    for (const entry of readdirSync(join(root, relative), {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) {
        entries.push([path, "directory"]);
        visit(path);
      } else {
        assert.equal(entry.isFile(), true, path);
        entries.push([path, readFileSync(join(root, path), "base64")]);
      }
    }
  };
  visit();
  return entries;
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
    "dist-web",
    "artifacts",
    "coverage",
    "src-tauri/target",
    "src-tauri/gen/schemas",
  ]) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
  assert.equal(existsSync(join(root, "node_modules/artifact")), true);
  assert.equal(run("--all").status, 0);
  assert.equal(existsSync(join(root, "node_modules")), false);
});

test("--artifacts only removes distributions and preserves build output and caches", (t) => {
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
    "dist-web",
    "coverage",
    "src-tauri/target",
    "src-tauri/gen/schemas",
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
    "dist-web",
    "artifacts",
    "coverage",
    "src-tauri/target",
    "src-tauri/gen/schemas",
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
  assert.throws(() => removeProjectPath(root, "."), /Refusing/);
  assert.throws(() => removeProjectPath(root, "../outside"), /Refusing/);
  symlinkSync(
    outside,
    join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => removeProjectPath(root, "linked/target"), /Refusing/);
  assert.equal(existsSync(join(outside, "target/keep")), true);
  assert.equal(removeProjectPath(root, "linked"), true);
  assert.equal(existsSync(join(outside, "target/keep")), true);
});

test("temporary cleanup removes scratch output while preserving released packages and real dependencies", (t) => {
  const { root } = fixture(t);
  const scratch = [
    "artifacts/e2e/screenshots/failure.png",
    "artifacts/branding-preview/preview.png",
    "artifacts/browser/trace.zip",
    "src-tauri/gen/schemas/desktop.json",
    "node_modules/.vite/deps/chunk.js",
    "node_modules/.vite-temp/config.mjs",
    "node_modules/.cache/tool/cache.json",
  ];
  const retained = [
    "artifacts/1.2.3/x86_64-pc-windows-msvc/installers/nsis/setup.exe",
    "artifacts/1.2.3/x86_64-pc-windows-msvc/portable/app.exe",
    "artifacts/unrelated-user-output/report.txt",
    "node_modules/example-package/index.js",
    "src-tauri/gen/keep.txt",
  ];
  for (const path of [...scratch, ...retained]) put(root, path, path);
  const result = runCleanup(root, "--temporary");
  assert.equal(result.status, 0, result.stderr);
  for (const path of scratch)
    assert.equal(existsSync(join(root, path)), false, path);
  for (const path of retained)
    assert.equal(readFileSync(join(root, path), "utf8"), path, path);
  for (const path of ["dist", "dist-web", "coverage", "src-tauri/target"])
    assert.equal(existsSync(join(root, path)), false, path);
  assert.equal(existsSync(join(root, "node_modules/artifact")), true);
});

test("temporary cleanup only recognizes portable backups in the exact version and target layout", (t) => {
  const { root } = fixture(t);
  const uuid = "12345678-1234-1234-1234-123456789aBc";
  const backup = `.portable-previous-${uuid}`;
  const removed = [
    `artifacts/1.2.3/x86_64-pc-windows-msvc/${backup}/app.exe`,
    `artifacts/2.0.0-beta.1+build.4/aarch64-apple-darwin/${backup}/app`,
  ];
  const retained = [
    `artifacts/review/x86_64-pc-windows-msvc/${backup}/keep`,
    `artifacts/1.2.3/${backup}/keep`,
    `artifacts/1.2.3/x86_64-pc-windows-msvc/${backup}-extra/keep`,
    "artifacts/1.2.3/x86_64-pc-windows-msvc/.portable-previous-invalid/keep",
    `artifacts/1.2.3/x86_64-pc-windows-msvc/.installers-previous-${uuid}/keep`,
    "artifacts/1.2.3/x86_64-pc-windows-msvc/.Portable-previous-abcdefab-1234-1234-1234-123456789abc/keep",
    `artifacts/1.2.3/other-target/${backup}`,
  ];
  for (const path of [...removed, ...retained]) put(root, path, path);
  const result = runCleanup(root, "--temporary");
  assert.equal(result.status, 0, result.stderr);
  for (const path of removed)
    assert.equal(existsSync(join(root, path)), false, path);
  for (const path of retained)
    assert.equal(readFileSync(join(root, path), "utf8"), path, path);
});

for (const mode of [[], ["--all"], ["--artifacts"], ["--temporary"]]) {
  test(`dry-run preserves every directory and file in ${mode[0] ?? "default"} mode`, (t) => {
    const { root } = fixture(t);
    put(root, "artifacts/e2e/screenshots/failure.png");
    put(root, "node_modules/.vite/deps/chunk.js");
    put(
      root,
      "artifacts/1.2.3/x86_64-pc-windows-msvc/.portable-previous-12345678-1234-1234-1234-123456789abc/app.exe",
    );
    const before = snapshot(root);
    const result = runCleanup(root, ...mode, "--dry-run");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshot(root), before);
  });
}

test("temporary mode conflicts and invalid arguments fail before deleting any files", (t) => {
  const { root } = fixture(t);
  put(root, "artifacts/e2e/failure.png");
  const before = snapshot(root);
  for (const args of [
    ["--temporary", "--all"],
    ["--artifacts", "--temporary"],
    ["--temporary", "--dry-run", "--artifacts"],
    ["--temporary", "../outside"],
    ["--dry-run", "--typo"],
  ]) {
    const result = runCleanup(root, ...args);
    assert.equal(result.status, 1, `${args}: ${result.stderr}`);
    assert.deepEqual(snapshot(root), before, args.join(" "));
  }
});

for (const scope of ["inside", "outside"]) {
  test(`cleanup rejects ${scope} ancestor directory links without changing linked contents`, (t) => {
    const { base, root } = fixture(t);
    const target = join(scope === "inside" ? root : base, "native-source");
    renameSync(join(root, "src-tauri"), target);
    symlinkSync(
      target,
      join(root, "src-tauri"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = runCleanup(root, "--temporary");
    assert.equal(result.status, 1, result.stderr);
    assert.equal(lstatSync(join(root, "src-tauri")).isSymbolicLink(), true);
    assert.equal(
      readFileSync(join(target, "target/artifact"), "utf8"),
      "keep until cleaned",
    );
  });

  test(`cleanup rejects a top-level ${scope} directory link`, (t) => {
    const { base, root } = fixture(t);
    const target = join(scope === "inside" ? root : base, "frontend-output");
    renameSync(join(root, "dist"), target);
    symlinkSync(
      target,
      join(root, "dist"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = runCleanup(root);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(lstatSync(join(root, "dist")).isSymbolicLink(), true);
    assert.equal(
      readFileSync(join(target, "artifact"), "utf8"),
      "keep until cleaned",
    );
  });
}

test("recursive cleanup removes nested directory links without traversing their targets", (t) => {
  const { base, root } = fixture(t);
  const outside = join(base, "outside");
  const inside = join(root, "retained-data");
  for (const [name, target] of [
    ["external-link", outside],
    ["internal-link", inside],
  ]) {
    put(target, "keep.txt", name);
    symlinkSync(
      target,
      join(root, "dist", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const result = runCleanup(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(root, "dist")), false);
  assert.equal(
    readFileSync(join(outside, "keep.txt"), "utf8"),
    "external-link",
  );
  assert.equal(readFileSync(join(inside, "keep.txt"), "utf8"), "internal-link");
});

test("Windows process probing accepts arrays, single processes and empty results", () => {
  const process = {
    ProcessId: 4242,
    ExecutablePath: "C:\\fixture\\dist\\app.exe",
  };
  for (const [value, expected] of [
    [process, [process]],
    [[process], [process]],
    [[], []],
  ]) {
    let calls = 0;
    const actual = getWindowsProcesses(() => {
      calls += 1;
      return { status: 0, stdout: JSON.stringify(value), stderr: "" };
    });
    assert.deepEqual(actual, expected);
    assert.equal(calls, 1);
  }
});

test("Windows process probe errors and unreadable process lists fail closed", () => {
  for (const result of [
    { error: new Error("process query unavailable"), status: null },
    { status: 1, stdout: "", stderr: "Access denied" },
    { status: null, signal: "SIGTERM", stdout: "" },
    { status: 0, stdout: "not JSON", stderr: "" },
    { status: 0, stdout: '{"unexpected":"shape"}', stderr: "" },
  ]) {
    assert.throws(() => getWindowsProcesses(() => result));
  }
});

test("running program protection uses Windows case-insensitive directory boundaries", () => {
  const target = "C:\\fixture\\dist";
  assert.throws(
    () =>
      assertNoRunningPrograms(target, [
        {
          ProcessId: 4242,
          ExecutablePath: "c:\\FIXTURE\\DIST\\nested\\app.exe",
        },
      ]),
    /4242/,
  );
  assert.doesNotThrow(() =>
    assertNoRunningPrograms(target, [
      { ProcessId: 1, ExecutablePath: "C:\\fixture\\dist-other\\app.exe" },
      { ProcessId: 2, ExecutablePath: "C:\\fixture\\other\\app.exe" },
      { ProcessId: 3, ExecutablePath: "D:\\fixture\\dist\\app.exe" },
    ]),
  );
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  loadPortableBuild,
  portableFileName,
  recordPortableBuild,
} from "./portable-lib.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tauri-portable-receipt-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const targetDirectory = join(root, "custom-target");
  const executable = join(targetDirectory, "release/app.exe");
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, "fresh portable program");
  const plan = {
    root,
    version: "1.2.3",
    config: { productName: "Desktop App" },
    buildArgs: ["--no-bundle"],
    metadata: { target_directory: targetDirectory },
  };
  const built = {
    executable,
    outputDir: dirname(executable),
    target: "x86_64-pc-windows-msvc",
  };
  return { root, plan, built };
}

test("portable receipt follows the actual Cargo output without forcing a second target cache", (t) => {
  const { plan, built } = fixture(t);
  recordPortableBuild(plan, built);
  assert.deepEqual(loadPortableBuild(plan), built);
  assert.equal(portableFileName("Desktop App"), "Desktop App.exe");
});

test("skip-build rejects absent receipts, configuration drift and rewritten executables", (t) => {
  const { plan, built } = fixture(t);
  assert.throws(() => loadPortableBuild(plan), /不能跳过构建/);
  recordPortableBuild(plan, built);
  assert.throws(() => loadPortableBuild({ ...plan, version: "1.2.4" }), /变化/);
  assert.throws(
    () => loadPortableBuild({ ...plan, config: { productName: "Other App" } }),
    /变化/,
  );
  assert.throws(
    () =>
      loadPortableBuild({
        ...plan,
        buildArgs: ["--features", "other", "--no-bundle"],
      }),
    /变化/,
  );
  writeFileSync(built.executable, "patched by installer bundling");
  assert.throws(() => loadPortableBuild(plan), /变化/);
});

test("portable filenames reject path traversal and reserved Windows names", () => {
  for (const name of [
    "../other",
    "..\\other",
    "NUL",
    "COM1.log",
    "app.",
    "app ",
    "app:name",
  ])
    assert.throws(() => portableFileName(name), /Windows/);
});

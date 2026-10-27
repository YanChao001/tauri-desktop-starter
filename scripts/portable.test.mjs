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
    optimize: "size",
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

test("portable receipts reuse the same optimization and reject both strategy changes", (t) => {
  const { plan, built } = fixture(t);
  for (const optimize of ["speed", "size"]) {
    const selected = { ...plan, optimize };
    recordPortableBuild(selected, built);
    assert.deepEqual(loadPortableBuild({ ...selected }), built);
    assert.throws(
      () =>
        loadPortableBuild({
          ...selected,
          optimize: optimize === "speed" ? "size" : "speed",
        }),
      /has changed/,
    );
  }
});

test("skip-build rejects absent receipts, configuration drift and rewritten executables", (t) => {
  const { plan, built } = fixture(t);
  assert.throws(() => loadPortableBuild(plan), /Cannot skip the build/);
  recordPortableBuild(plan, built);
  assert.throws(
    () => loadPortableBuild({ ...plan, version: "1.2.4" }),
    /has changed/,
  );
  assert.throws(
    () => loadPortableBuild({ ...plan, config: { productName: "Other App" } }),
    /has changed/,
  );
  assert.throws(
    () =>
      loadPortableBuild({
        ...plan,
        buildArgs: ["--features", "other", "--no-bundle"],
      }),
    /has changed/,
  );
  writeFileSync(built.executable, "patched by installer bundling");
  assert.throws(() => loadPortableBuild(plan), /has changed/);
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

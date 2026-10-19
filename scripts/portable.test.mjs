import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  assertSeparateOutput,
  buildEnvironment,
  portablePaths,
} from "./portable-lib.mjs";

const root = resolve("portable-fixture");
const manifest = join(root, "src-tauri/Cargo.toml");
const target = "x86_64-pc-windows-msvc";
const metadata = {
  target_directory: resolve("custom-target"),
  packages: [
    {
      name: "rust-app",
      manifest_path: manifest,
      default_run: "desktop",
      targets: [
        { name: "rust_app_lib", kind: ["rlib", "cdylib"] },
        { name: "desktop", kind: ["bin"] },
        { name: "helper", kind: ["bin"] },
      ],
    },
  ],
};

test("portable output follows Cargo's target directory and default-run", () => {
  assert.deepEqual(portablePaths(root, {}, metadata, target), {
    productName: "rust-app",
    builtExe: join(metadata.target_directory, target, "release/desktop.exe"),
    portableExe: join(root, "dist-portable/rust-app.exe"),
  });
  const paths = portablePaths(
    root,
    { productName: "Desktop App", mainBinaryName: "renamed" },
    metadata,
    target,
  );
  assert.equal(
    paths.builtExe,
    join(metadata.target_directory, target, "release/renamed.exe"),
  );
  assert.equal(paths.portableExe, join(root, "dist-portable/Desktop App.exe"));
});

test("ambiguous binaries and unsafe output names fail before collecting files", () => {
  const ambiguous = structuredClone(metadata);
  ambiguous.packages[0].default_run = null;
  assert.throws(
    () => portablePaths(root, {}, ambiguous, target),
    /default-run/,
  );
  for (const name of [
    "../other",
    "..\\other",
    "NUL",
    "COM1.log",
    "app.",
    "app ",
    "app:name",
  ]) {
    assert.throws(
      () => portablePaths(root, { productName: name }, metadata, target),
      /Windows/,
    );
    assert.throws(
      () => portablePaths(root, { mainBinaryName: name }, metadata, target),
      /Windows/,
    );
  }
});

test("portable collection refuses to delete its own Cargo source directory", (t) => {
  const output = mkdtempSync(join(tmpdir(), "tauri-portable-output-"));
  t.after(() => {
    assert.equal(dirname(output), resolve(tmpdir()));
    rmSync(output, { recursive: true, force: true });
  });
  const source = join(output, "target/app.exe");
  mkdirSync(dirname(source));
  writeFileSync(source, "compiled application");
  assert.throws(() => assertSeparateOutput(source, output), /拒绝清理/);
});

test("Windows child processes receive one PATH and respect CARGO_HOME", (t) => {
  const cargoHome = mkdtempSync(join(tmpdir(), "tauri-cargo-home-"));
  t.after(() => {
    assert.equal(dirname(cargoHome), resolve(tmpdir()));
    rmSync(cargoHome, { recursive: true, force: true });
  });
  mkdirSync(join(cargoHome, "bin"));
  writeFileSync(join(cargoHome, "bin/cargo.exe"), "");
  const input = { Path: "tools", PATH: "other-tools", CARGO_HOME: cargoHome };
  const env = buildEnvironment(input);
  assert.deepEqual(
    Object.keys(env).filter((key) => /^path$/i.test(key)),
    ["PATH"],
  );
  assert.equal(env.PATH, `${join(cargoHome, "bin")};tools;other-tools`);
  assert.equal(input.Path, "tools");
});

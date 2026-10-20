import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { artifactDirectory, publishArtifacts } from "./artifact-lib.mjs";
import { actionArtifactEntries } from "./collect-artifacts.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tauri-artifacts-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const source = join(root, "compiled.exe");
  writeFileSync(source, "current build");
  return { root, source };
}

test("publishing replaces only the current version, platform and artifact kind", (t) => {
  const { root, source } = fixture(t);
  const plan = {
    version: "1.2.3",
    target: "x86_64-pc-windows-msvc",
    kind: "installers",
    entries: [{ source, path: "nsis/app-setup.exe" }],
  };
  const output = publishArtifacts(root, plan);
  writeFileSync(join(output, "stale.msi"), "old build");
  const portable = artifactDirectory(
    root,
    plan.version,
    plan.target,
    "portable",
  );
  mkdirSync(portable);
  writeFileSync(join(portable, "keep.exe"), "portable");
  publishArtifacts(root, plan);
  assert.equal(existsSync(join(output, "stale.msi")), false);
  assert.equal(
    readFileSync(join(output, "nsis/app-setup.exe"), "utf8"),
    "current build",
  );
  assert.equal(readFileSync(join(portable, "keep.exe"), "utf8"), "portable");
  const manifest = JSON.parse(
    readFileSync(join(output, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.files[0].path, "nsis/app-setup.exe");
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
});

test("invalid or missing build files preserve the prior successful distribution", (t) => {
  const { root, source } = fixture(t);
  const plan = {
    version: "1.0.0",
    target: "x86_64-pc-windows-msvc",
    kind: "portable",
    entries: [{ source, path: "app.exe" }],
  };
  const output = publishArtifacts(root, plan);
  for (const entries of [
    [],
    [{ source, path: "../escape.exe" }],
    [{ source: join(root, "missing.exe"), path: "app.exe" }],
    [{ source: join(output, "app.exe"), path: "app.exe" }],
  ]) {
    assert.throws(() => publishArtifacts(root, { ...plan, entries }));
    assert.equal(
      readFileSync(join(output, "app.exe"), "utf8"),
      "current build",
    );
  }
  assert.throws(() =>
    artifactDirectory(root, "../other", plan.target, plan.kind),
  );
});

test("artifact publishing rejects junction redirects before writing", (t) => {
  const { root, source } = fixture(t);
  const outside = join(root, "another-directory");
  mkdirSync(outside);
  symlinkSync(
    outside,
    join(root, "artifacts"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () =>
      publishArtifacts(root, {
        version: "1.0.0",
        target: "x86_64-pc-windows-msvc",
        kind: "portable",
        entries: [{ source, path: "app.exe" }],
      }),
    /目录链接/,
  );
  assert.equal(existsSync(join(outside, "1.0.0")), false);
});

test("publication normalizes separators and refuses sources containing its destination", (t) => {
  const { root, source } = fixture(t);
  const plan = {
    version: "1.0.0",
    target: "x86_64-pc-windows-msvc",
    kind: "installers",
    entries: [{ source, path: "nsis\\app.exe" }],
  };
  const output = publishArtifacts(root, plan);
  assert.equal(existsSync(join(output, "nsis/app.exe")), true);
  assert.throws(
    () =>
      publishArtifacts(root, {
        ...plan,
        entries: [{ source: root, path: "everything" }],
      }),
    /包含发布目录/,
  );
  assert.equal(
    readFileSync(join(output, "nsis/app.exe"), "utf8"),
    "current build",
  );
});

test("CI collection uses explicit action paths and signatures without scanning stale bundles", (t) => {
  const { root } = fixture(t);
  const directory = join(root, "target/release/bundle/nsis");
  mkdirSync(directory, { recursive: true });
  const current = join(directory, "app_1.0.0-setup.exe");
  writeFileSync(current, "current");
  writeFileSync(`${current}.sig`, "signature");
  writeFileSync(join(directory, "old_0.9.0-setup.exe"), "stale");
  assert.deepEqual(actionArtifactEntries([current]), [
    { source: current, path: "nsis/app_1.0.0-setup.exe" },
  ]);
  assert.deepEqual(actionArtifactEntries([current, `${current}.sig`]), [
    { source: current, path: "nsis/app_1.0.0-setup.exe" },
    { source: `${current}.sig`, path: "nsis/app_1.0.0-setup.exe.sig" },
  ]);
  assert.throws(
    () => actionArtifactEntries([join(root, "build-script-build.exe")]),
    /不.*Tauri/,
  );
  assert.throws(() => actionArtifactEntries(null), /有效/);
});

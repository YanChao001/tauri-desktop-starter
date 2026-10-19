import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { checkVersions, validateVersion } from "./version.mjs";

function fixture(t, { config = {}, manifest, lock } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tauri-version-test-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "src-tauri"));
  mkdirSync(join(root, "scripts"));
  for (const script of [
    "set-version.mjs",
    "version.mjs",
    "check-version.mjs",
  ]) {
    copyFileSync(
      new URL(script, import.meta.url),
      join(root, "scripts", script),
    );
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "frontend-name", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "1.0.0", bundle: { targets: "all" }, ...config }),
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    manifest ??
      '[package]\r\nname = "rust-name"\r\nversion = "1.0.0" # retain comment\r\n\r\n[dependencies]\r\nother = "1.0.0"\r\n',
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.lock"),
    lock ??
      'version = 4\n\n[[package]]\nname = "rust-name"\nversion = "9.0.0"\nsource = "registry+https://example.com"\n\n[[package]]\nname = "rust-name"\nversion = "1.0.0"\n',
  );
  return root;
}

function setVersion(root, version) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts/set-version.mjs"), version],
    {
      encoding: "utf8",
    },
  );
}

test("version:set synchronizes the Rust package even when the npm name differs", (t) => {
  const root = fixture(t);
  const result = setVersion(root, "2.3.4");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(checkVersions(root, "v2.3.4"), "2.3.4");
  const manifest = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  assert.match(manifest, /version = "2\.3\.4" # retain comment\r\n/);
  assert.match(manifest, /other = "1\.0\.0"/);
  const lock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  assert.match(lock, /version = "9\.0\.0"\nsource = "registry/);
});

test("invalid manifest or missing local lock package leaves every file unchanged", (t) => {
  for (const override of [
    { manifest: '[package]\nname = "rust-name"\n' },
    {
      lock: 'version = 4\n\n[[package]]\nname = "different"\nversion = "1.0.0"\n',
    },
  ]) {
    const root = fixture(t, override);
    const files = [
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ];
    const before = files.map((file) => readFileSync(join(root, file), "utf8"));
    assert.equal(setVersion(root, "2.0.0").status, 1);
    assert.deepEqual(
      files.map((file) => readFileSync(join(root, file), "utf8")),
      before,
    );
  }
});

test("strict SemVer and MSI constraints reject versions before writing", (t) => {
  const root = fixture(t);
  for (const version of [
    "01.2.3",
    "1.2.3-01",
    "1.2.3-alpha..1",
    "256.0.0",
    "1.2.65536",
    "1.2.3-beta.1",
    "1.2.3+abc",
  ]) {
    assert.equal(setVersion(root, version).status, 1, version);
    assert.equal(checkVersions(root), "1.0.0");
  }
});

test("supported prereleases and build metadata synchronize without losing identifiers", (t) => {
  const root = fixture(t);
  for (const version of [
    "1.2.3-4",
    "1.2.3+5",
    "1.2.3-beta.1+6",
    "255.255.65535+65535",
  ]) {
    const result = setVersion(root, version);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(checkVersions(root, `v${version}`), version);
  }
  validateVersion("1.2.3-beta.1+build.abc", { bundle: { targets: ["nsis"] } });
  validateVersion("1.2.3-beta.1", {
    bundle: { targets: "all", windows: { wix: { version: "1.2.3.4" } } },
  });
});

test("release validation rejects tag mismatches and drift in any manifest", (t) => {
  const root = fixture(t);
  assert.throws(() => checkVersions(root, "v9.0.0"), /tag/);
  for (const path of [
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ]) {
    const file = join(root, path);
    const previous = readFileSync(file, "utf8");
    writeFileSync(file, previous.replace('"1.0.0"', '"1.0.1"'));
    assert.throws(() => checkVersions(root), /不一致/);
    writeFileSync(file, previous);
  }
});

test("release outputs distinguish prereleases from build metadata", (t) => {
  const root = fixture(t);
  const output = join(root, "github-output");
  for (const [version, prerelease] of [
    ["2.3.4-5", true],
    ["2.3.4+5", false],
  ]) {
    assert.equal(setVersion(root, version).status, 0);
    writeFileSync(output, "");
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/check-version.mjs")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REF: `refs/tags/v${version}`,
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(output, "utf8"),
      `version=${version}\nprerelease=${prerelease}\n`,
    );
  }
});

test("missing tracked Cargo.lock fails validation and leaves version files unchanged", (t) => {
  const root = fixture(t);
  rmSync(join(root, "src-tauri/Cargo.lock"));
  assert.throws(() => checkVersions(root), /ENOENT/);
  assert.equal(setVersion(root, "2.0.0").status, 1);
  assert.equal(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
    "1.0.0",
  );
});

test("an explicit MSI version is validated before any version file is written", (t) => {
  for (const version of [
    "256.1.0",
    "1.256.0",
    "1.2.65536",
    "1.2.3.65536",
    "1.2",
    "1.2.3-beta",
    "",
    123,
  ]) {
    const root = fixture(t, {
      config: { bundle: { targets: ["msi"], windows: { wix: { version } } } },
    });
    assert.equal(setVersion(root, "2.0.0").status, 1, String(version));
    assert.equal(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
      "1.0.0",
    );
  }
  validateVersion("1.2.3-beta.1", {
    bundle: {
      targets: ["msi"],
      windows: { wix: { version: "255.255.65535.65535" } },
    },
  });
});

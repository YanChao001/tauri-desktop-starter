import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { checkVersions, validateVersion } from "./version.mjs";

function fixture(t, { config = {}, manifest, lock, dependencies = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tauri-version-test-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "src-tauri"));
  mkdirSync(join(root, "scripts"));
  if (dependencies)
    symlinkSync(
      resolve(import.meta.dirname, "../node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  for (const script of ["version.mjs", "fs-utils.mjs"]) {
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

function runVersion(root, args, env = {}) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts/version.mjs"), ...args],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF: "", GITHUB_OUTPUT: "", ...env },
    },
  );
}

function setVersion(root, version) {
  return runVersion(root, ["set", version]);
}

function versionContents(root) {
  return [
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ].map((path) => readFileSync(join(root, path), "utf8"));
}

test("version check runs without installed dependencies", (t) => {
  const root = fixture(t, { dependencies: false });
  assert.equal(existsSync(join(root, "node_modules")), false);
  const before = versionContents(root);
  const result = runVersion(root, ["check"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\.0\.0/);
  assert.deepEqual(versionContents(root), before);
});

test("version check prioritizes explicit tags and only appends CI outputs after validation", (t) => {
  const root = fixture(t, { dependencies: false });
  const output = join(root, "github-output");
  writeFileSync(output, "existing output\n");
  const result = runVersion(root, ["check", "v1.0.0"], {
    GITHUB_REF: "refs/tags/v9.0.0",
    GITHUB_OUTPUT: output,
  });
  assert.equal(result.status, 0, result.stderr);
  const expected = "existing output\nversion=1.0.0\nprerelease=false\n";
  assert.equal(readFileSync(output, "utf8"), expected);
  for (const [args, reference] of [
    [["check"], "refs/tags/v9.0.0"],
    [["check", "v9.0.0"], "refs/tags/v1.0.0"],
  ]) {
    const rejected = runVersion(root, args, {
      GITHUB_REF: reference,
      GITHUB_OUTPUT: output,
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /tag/);
    assert.equal(readFileSync(output, "utf8"), expected);
  }
});

test("invalid CLI arguments leave version files and CI outputs unchanged", (t) => {
  const root = fixture(t, { dependencies: false });
  const before = versionContents(root);
  const output = join(root, "github-output");
  writeFileSync(output, "keep output\n");
  for (const args of [
    [],
    ["unknown"],
    ["set"],
    ["set", ""],
    ["set", "2.0.0", "extra"],
    ["check", "v1.0.0", "extra"],
    ["check", "--unknown"],
    ["set", "--unknown"],
    ["--help", "extra"],
    ["set", "2.0.0", "--help"],
  ]) {
    const result = runVersion(root, args, { GITHUB_OUTPUT: output });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /Usage/);
    assert.deepEqual(versionContents(root), before);
    assert.equal(readFileSync(output, "utf8"), "keep output\n");
  }
});

test("help and importing the version module perform no CLI I/O", (t) => {
  const root = fixture(t, { dependencies: false });
  rmSync(join(root, "src-tauri/Cargo.lock"));
  const output = join(root, "github-output");
  writeFileSync(output, "keep output\n");
  const env = { GITHUB_REF: "refs/tags/v9.0.0", GITHUB_OUTPUT: output };
  for (const args of [["--help"], ["-h"], ["check", "--help"], ["set", "-h"]]) {
    const result = runVersion(root, args, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /check \[tag\].*set <version>/);
    assert.equal(result.stderr, "");
  }
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(join(root, "scripts/version.mjs")).href)})`,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(readFileSync(output, "utf8"), "keep output\n");
  assert.equal(existsSync(join(root, "src-tauri/Cargo.lock")), false);
});

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

test("version:set preserves project JSON formatting after a normal release bump", async (t) => {
  const root = fixture(t, {
    config: {
      plugins: { updater: { pubkey: "", endpoints: [] } },
    },
  });
  writeFileSync(join(root, ".prettierrc.json"), '{"printWidth":60}');
  const result = setVersion(root, "2.0.0");
  assert.equal(result.status, 0, result.stderr);
  for (const path of ["package.json", "src-tauri/tauri.conf.json"]) {
    const content = readFileSync(join(root, path), "utf8");
    assert.equal(
      content,
      await format(content, { parser: "json", printWidth: 60 }),
    );
  }
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

test("version commands reject directory links that point outside the project", (t) => {
  const root = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "tauri-version-outside-"));
  t.after(() => {
    assert.equal(dirname(outside), resolve(tmpdir()));
    rmSync(outside, { recursive: true, force: true });
  });
  const original = readFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    "utf8",
  );
  writeFileSync(join(outside, "tauri.conf.json"), original);
  rmSync(join(root, "src-tauri"), { recursive: true });
  symlinkSync(
    outside,
    join(root, "src-tauri"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(setVersion(root, "2.0.0").status, 1);
  assert.equal(
    readFileSync(join(outside, "tauri.conf.json"), "utf8"),
    original,
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
    "1.0.0",
  );
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
    assert.throws(() => checkVersions(root), /does not match/);
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
    const result = runVersion(root, ["check"], {
      GITHUB_REF: `refs/tags/v${version}`,
      GITHUB_OUTPUT: output,
    });
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

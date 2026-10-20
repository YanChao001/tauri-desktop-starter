import assert from "node:assert/strict";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { publishArtifacts } from "./artifact-lib.mjs";
import { renameWithRetry } from "./rename-with-retry.mjs";

function lockError(code = "EPERM") {
  return Object.assign(new Error("directory is temporarily in use"), { code });
}

test("Windows transient rename retries revalidate paths and retain the original error", () => {
  const waits = [];
  let attempts = 0;
  let validations = 0;
  renameWithRetry("source", "target", {
    platform: "win32",
    validate: () => {
      validations += 1;
    },
    rename: () => {
      if (++attempts < 3) throw lockError();
    },
    delay: (value) => waits.push(value),
  });
  assert.equal(attempts, 3);
  assert.equal(validations, 3);
  assert.deepEqual(waits, [100, 200]);

  const original = lockError();
  attempts = 0;
  waits.length = 0;
  assert.throws(
    () =>
      renameWithRetry("source", "target", {
        platform: "win32",
        validate: () => {},
        rename: () => {
          attempts += 1;
          throw original;
        },
        delay: (value) => waits.push(value),
      }),
    (error) => error === original && error.code === "EPERM",
  );
  assert.equal(attempts, 5);
  assert.equal(
    waits.reduce((sum, value) => sum + value, 0),
    1300,
  );
});

test("rename retry stops immediately for changed paths, other errors and non-Windows hosts", () => {
  let validations = 0;
  let attempts = 0;
  assert.throws(
    () =>
      renameWithRetry("source", "target", {
        platform: "win32",
        validate: () => {
          if (++validations === 2) throw new Error("path changed");
        },
        rename: () => {
          attempts += 1;
          throw lockError();
        },
        delay: () => {},
      }),
    /path changed/,
  );
  assert.equal(attempts, 1);
  for (const [platform, code] of [
    ["linux", "EPERM"],
    ["win32", "ENOENT"],
  ]) {
    attempts = 0;
    assert.throws(
      () =>
        renameWithRetry("source", "target", {
          platform,
          validate: () => {},
          rename: () => {
            attempts += 1;
            throw lockError(code);
          },
          delay: () => assert.fail("must not delay"),
        }),
      (error) => error.code === code,
    );
    assert.equal(attempts, 1);
  }
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tauri-rename-publication-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const source = join(root, "compiled.exe");
  writeFileSync(source, "old build");
  const plan = {
    version: "1.0.0",
    target: "x86_64-pc-windows-msvc",
    kind: "installers",
    entries: [{ source, path: "nsis/setup.exe" }],
  };
  const output = publishArtifacts(root, plan);
  writeFileSync(source, "new build");
  return { root, source, plan, output };
}

function interceptRename(t, replacement) {
  const original = fs.renameSync;
  const mock = t.mock.method(fs, "renameSync", (source, destination) =>
    replacement(source, destination, original),
  );
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
}

test(
  "a transient Windows publication lock succeeds without mixing old installers",
  { skip: process.platform !== "win32" },
  (t) => {
    const { root, plan, output } = fixture(t);
    writeFileSync(join(output, "stale_en-US.msi"), "old language");
    let attempts = 0;
    interceptRename(t, (source, destination, original) => {
      if (source === output && ++attempts === 1) throw lockError();
      return original(source, destination);
    });
    assert.equal(publishArtifacts(root, plan), output);
    assert.equal(attempts, 2);
    assert.equal(
      readFileSync(join(output, "nsis/setup.exe"), "utf8"),
      "new build",
    );
    assert.equal(existsSync(join(output, "stale_en-US.msi")), false);
  },
);

test("exhausted publication retries preserve the old distribution and error code", (t) => {
  const { root, plan, output } = fixture(t);
  const manifest = readFileSync(join(output, "manifest.json"), "utf8");
  mkdirSync(join(output, "keep"));
  writeFileSync(join(output, "keep/original"), "old distribution");
  interceptRename(t, (source, destination, original) => {
    if (source === output) throw lockError();
    return original(source, destination);
  });
  assert.throws(
    () => publishArtifacts(root, plan),
    (error) => error.code === "EPERM",
  );
  assert.equal(
    readFileSync(join(output, "nsis/setup.exe"), "utf8"),
    "old build",
  );
  assert.equal(
    readFileSync(join(output, "keep/original"), "utf8"),
    "old distribution",
  );
  assert.equal(readFileSync(join(output, "manifest.json"), "utf8"), manifest);
});

test(
  "publication rollback also tolerates a transient Windows restore lock",
  { skip: process.platform !== "win32" },
  (t) => {
    const { root, plan, output } = fixture(t);
    let restoreAttempts = 0;
    interceptRename(t, (source, destination, original) => {
      if (destination === output && source.includes("-previous-")) {
        if (++restoreAttempts === 1) throw lockError("EBUSY");
      } else if (destination === output) {
        throw lockError();
      }
      return original(source, destination);
    });
    assert.throws(
      () => publishArtifacts(root, plan),
      (error) => error.code === "EPERM",
    );
    assert.equal(restoreAttempts, 2);
    assert.equal(
      readFileSync(join(output, "nsis/setup.exe"), "utf8"),
      "old build",
    );
  },
);

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyChanges, detectChanges } from "./ci-scope.mjs";

const full = { docsOnly: false, rustRequired: true, sdkRequired: true };
const native = { docsOnly: false, rustRequired: true, sdkRequired: false };

test("documentation changes skip browser and native checks", () => {
  assert.deepEqual(
    classifyChanges([
      "README.en.md",
      "docs/testing.md",
      "docs/assets/preview.png",
    ]),
    { docsOnly: true, rustRequired: false, sdkRequired: false },
  );
});

test("frontend changes keep desktop coverage without repeating Rust checks", () => {
  for (const path of [
    "src/pages/settings.tsx",
    "src/styles/app.css",
    "public/fixture.json",
    "index.html",
    "tsconfig.node.json",
    "vite.config.ts",
    "playwright.config.ts",
    "e2e/browser/desktop-ui.spec.ts",
  ]) {
    assert.deepEqual(classifyChanges([path, "docs/testing.md"]), {
      docsOnly: false,
      rustRequired: false,
      sdkRequired: false,
    });
  }
});

test("unrelated native and unknown inputs retain native checks without an SDK build", () => {
  for (const path of [
    "src-tauri/src/commands.rs",
    "src/lib/generated/bindings.ts",
    "src/lib/generated/new-contract.ts",
    "src-tauri/src/database.rs",
    "src-tauri/src/storage.rs",
    "sdk/extension-ui.js",
    "scripts/build-extension-apps.mjs",
    "resources/extensions/demo-apps.wasm",
    "resources/wallpapers/background.jpg",
    "marketplace",
    "new-build-input.json",
  ]) {
    assert.deepEqual(classifyChanges(["src/App.tsx", path]), native, path);
  }
  assert.deepEqual(classifyChanges([]), full);
});

test("SDK runtime, examples, compiler inputs and acceptance tooling require SDK checks", () => {
  for (const path of [
    "src-tauri/src/bin/extension-tool.rs",
    "src-tauri/src/extension_runtime.rs",
    "src-tauri/src/extension_worker.rs",
    "src-tauri/src/extensions.rs",
    "src-tauri/src/extension_view.rs",
    "src-tauri/src/extension_runtime/compiler.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/error.rs",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/build.rs",
    "src-tauri/vendor/wasmtime/src/lib.rs",
    ".cargo/config.toml",
    "src-tauri/.cargo/config.toml",
    "rust-toolchain.toml",
    "package.json",
    "pnpm-lock.yaml",
    "examples/extensions/javascript/plugin.js",
    "examples/extensions/typescript/notebook-smoke.json",
    "examples/extensions/sdk.ts",
    "examples/extensions/build.mjs",
    "examples/extensions/package.json",
    "examples/extensions/pnpm-lock.yaml",
    "scripts/ci-extension-sdk.mjs",
    "scripts/extension-package.mjs",
    "scripts/extension-ui-resources.mjs",
    "scripts/build-lib.mjs",
    ".github/workflows/ci.yml",
  ]) {
    assert.deepEqual(classifyChanges([path, "docs/testing.md"]), full, path);
  }
});

test("manual runs, initial pushes and missing revisions cannot skip native checks", () => {
  assert.deepEqual(detectChanges("workflow_dispatch", {}), full);
  assert.deepEqual(
    detectChanges("push", { before: "0".repeat(40), after: "a".repeat(40) }),
    full,
  );
  assert.deepEqual(detectChanges("pull_request", {}), full);
  const warnings = [];
  assert.deepEqual(
    detectChanges(
      "push",
      { before: "a".repeat(40), after: "b".repeat(40) },
      {
        warn: (message) => warnings.push(message),
      },
    ),
    full,
  );
  assert.equal(warnings.length, 1);
});

test("a source moved into docs still requires native checks; PRs compare from the merge base", () => {
  const directory = mkdtempSync(join(tmpdir(), "starter-ci-scope-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (message) => {
    git("add", ".");
    git(
      "-c",
      "user.name=CI test",
      "-c",
      "user.email=ci@example.invalid",
      "commit",
      "-m",
      message,
    );
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-b", "base");
    mkdirSync(join(directory, "src-tauri"));
    mkdirSync(join(directory, "docs"));
    writeFileSync(join(directory, "src-tauri", "source.rs"), "// source\n");
    const base = commit("base");
    git("switch", "-c", "topic");
    writeFileSync(join(directory, "docs", "guide.md"), "Guide\n");
    const docs = commit("docs");
    git("switch", "base");
    writeFileSync(
      join(directory, "src-tauri", "source.rs"),
      "// base advanced\n",
    );
    const advancedBase = commit("advance base");
    assert.deepEqual(
      detectChanges(
        "pull_request",
        {
          pull_request: { base: { sha: advancedBase }, head: { sha: docs } },
        },
        { cwd: directory },
      ),
      { docsOnly: true, rustRequired: false, sdkRequired: false },
    );
    git("switch", "topic");
    renameSync(
      join(directory, "src-tauri", "source.rs"),
      join(directory, "docs", "source.md"),
    );
    const moved = commit("move source into docs");
    assert.deepEqual(
      detectChanges("push", { before: base, after: moved }, { cwd: directory }),
      native,
    );
  } finally {
    // Only the directory created by this test is removed.
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildExtensionApps } from "./build-extension-apps.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "starter-demo-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = {};
  for (const [name, path, content] of [
    ["Cargo.toml", "examples/extensions/apps/Cargo.toml", "[package]\n"],
    ["Cargo.lock", "examples/extensions/apps/Cargo.lock", "version = 4\n"],
    ["src/lib.rs", "examples/extensions/apps/src/lib.rs", "fn main() {}\n"],
    [
      "extension.json",
      "examples/extensions/apps/extension.json",
      '{"formatVersion":3}\n',
    ],
    [
      "rust-toolchain.toml",
      "rust-toolchain.toml",
      '[toolchain]\nchannel = "1.99.1"\n',
    ],
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content.replaceAll("\n", "\r\n"));
    sources[name] = digest(content);
  }
  const resources = join(root, "resources/extensions");
  await mkdir(resources, { recursive: true });
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await writeFile(join(resources, "demo-apps.wasm"), wasm);
  // Receipt property order and checkout line endings do not affect freshness.
  await writeFile(
    join(resources, "demo-apps.json"),
    JSON.stringify({
      sources: Object.fromEntries(Object.entries(sources).reverse()),
      sha256: digest(wasm),
    }),
  );
  return root;
}

test("快速检查接受等效换行和收据顺序，但拒绝源码、工具链与模块漂移", async (t) => {
  const root = await fixture(t);
  await buildExtensionApps(root, { check: true });
  for (const path of [
    "examples/extensions/apps/src/lib.rs",
    "examples/extensions/apps/extension.json",
    "rust-toolchain.toml",
    "resources/extensions/demo-apps.wasm",
  ]) {
    const absolute = join(root, path);
    const original = await readFile(absolute);
    await writeFile(
      absolute,
      Buffer.concat([original, Buffer.from("changed")]),
    );
    await assert.rejects(buildExtensionApps(root, { check: true }), /请运行/);
    assert.deepEqual(
      await readFile(absolute),
      Buffer.concat([original, Buffer.from("changed")]),
    );
    await writeFile(absolute, original);
  }
});

test("重建验证必须显式选择检查模式", async (t) => {
  const root = await fixture(t);
  await assert.rejects(buildExtensionApps(root, { rebuild: true }), /--check/);
});

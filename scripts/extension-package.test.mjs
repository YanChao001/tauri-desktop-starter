import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionPackage, packExtension } from "./extension-package.mjs";

const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const manifest = { formatVersion: 2, apiVersion: 1 };
test("保留 Wasm 原始字节并拒绝原生程序、旧包和超限输入", () => {
  const result = createExtensionPackage(manifest, wasm);
  assert.deepEqual(
    Buffer.from(JSON.parse(result.content).wasm, "base64"),
    wasm,
  );
  assert.equal(result.sha256.length, 64);
  assert.throws(() =>
    createExtensionPackage(manifest, Buffer.from("MZnative")),
  );
  assert.throws(() =>
    createExtensionPackage({ ...manifest, formatVersion: 1 }, wasm),
  );
  assert.throws(() =>
    createExtensionPackage(manifest, Buffer.alloc(16 * 1024 * 1024 + 1)),
  );
});
test("打包不覆盖清单、模块或已有输出", async () => {
  const root = await mkdtemp(join(tmpdir(), "starter-extension-pack-"));
  try {
    const manifestPath = join(root, "manifest.json"),
      wasmPath = join(root, "plugin.wasm"),
      outputPath = join(root, "package.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(wasmPath, wasm);
    const options = { manifestPath, wasmPath, outputPath };
    await assert.rejects(
      packExtension({ ...options, outputPath: manifestPath }),
    );
    await assert.rejects(packExtension({ ...options, outputPath: wasmPath }));
    await packExtension(options);
    await assert.rejects(packExtension(options));
    assert.deepEqual(await readFile(wasmPath), wasm);
    assert.deepEqual(
      JSON.parse(await readFile(outputPath, "utf8")).manifest,
      manifest,
    );
  } finally {
    // This directory was created by mkdtemp above and contains only this test's files.
    await rm(root, { recursive: true, force: true });
  }
});

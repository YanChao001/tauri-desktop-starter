import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packExtension,
  validateExtension,
  testExtension,
  parseArguments,
} from "./extension-package.mjs";

const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const manifest = {
  formatVersion: 3,
  apiVersion: 2,
  id: "example.test",
  commands: [],
};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "starter-extension-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    manifestPath: join(root, "extension.json"),
    wasmPath: join(root, "plugin.wasm"),
    outputPath: join(root, "package.json"),
    fixturePath: join(root, "smoke.json"),
  };
  await Promise.all([
    writeFile(options.manifestPath, JSON.stringify(manifest)),
    writeFile(options.wasmPath, wasm),
    writeFile(
      options.fixturePath,
      JSON.stringify({
        command: "uppercase",
        input: "Hello",
        expectOutput: "HELLO",
      }),
    ),
  ]);
  return options;
}
const validator = { runTool: async () => ({ validated: true }) };

test("打包先委托 Rust 完整校验，再保存同一份模块快照", async (t) => {
  const options = await fixture(t);
  let snapshot;
  const result = await packExtension(options, {
    runTool: async (command, paths) => {
      assert.equal(command, "validate");
      snapshot = paths;
      assert.notEqual(paths.wasmPath, options.wasmPath);
      assert.deepEqual(await readFile(paths.wasmPath), wasm);
      assert.deepEqual(
        JSON.parse(await readFile(paths.manifestPath, "utf8")),
        manifest,
      );
      await writeFile(options.wasmPath, "changed during validation");
      return { validated: true };
    },
  });
  const packaged = JSON.parse(await readFile(result.path, "utf8"));
  assert.deepEqual(Buffer.from(packaged.wasm, "base64"), wasm);
  assert.deepEqual(packaged.manifest, manifest);
  assert.equal(result.sha256.length, 64);
  await assert.rejects(access(snapshot.wasmPath));
});

test("校验失败不生成包且清理临时快照", async (t) => {
  const options = await fixture(t);
  let snapshot;
  await assert.rejects(
    packExtension(options, {
      runTool: async (_command, paths) => {
        snapshot = paths;
        throw new Error("Missing declared Wasm export");
      },
    }),
    /Missing declared/,
  );
  await assert.rejects(access(options.outputPath));
  await assert.rejects(access(snapshot.manifestPath));
});

test("拒绝原生程序与超限输入，且不调用 Rust", async (t) => {
  const options = await fixture(t);
  const failIfCalled = {
    runTool: () => assert.fail("invalid input reached Rust"),
  };
  for (const bytes of [
    Buffer.from("MZnative"),
    Buffer.alloc(16 * 1024 * 1024 + 1),
  ]) {
    await writeFile(options.wasmPath, bytes);
    await assert.rejects(packExtension(options, failIfCalled));
  }
  await writeFile(options.wasmPath, wasm);
  await writeFile(options.manifestPath, JSON.stringify({ id: 3 }));
  await assert.rejects(packExtension(options, failIfCalled));
});

test("打包不覆盖清单、模块或已有输出", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    packExtension({ ...options, outputPath: options.manifestPath }, validator),
  );
  await assert.rejects(
    packExtension({ ...options, outputPath: options.wasmPath }, validator),
  );
  await packExtension(options, validator);
  await assert.rejects(packExtension(options, validator), { code: "EEXIST" });
  assert.deepEqual(await readFile(options.wasmPath), wasm);
});

test("validate 和 test 传递离线测试快照并返回 Rust 报告", async (t) => {
  const options = await fixture(t);
  const calls = [];
  let expectedFixture = JSON.parse(await readFile(options.fixturePath, "utf8"));
  const dependency = {
    runTool: async (command, paths) => {
      calls.push(command);
      if (command === "test")
        assert.deepEqual(
          JSON.parse(await readFile(paths.fixturePath, "utf8")),
          expectedFixture,
        );
      return { command, validated: true };
    },
  };
  assert.deepEqual(await validateExtension(options, dependency), {
    command: "validate",
    validated: true,
  });
  assert.deepEqual(await testExtension(options, dependency), {
    command: "test",
    validated: true,
  });
  expectedFixture = [
    expectedFixture,
    { command: "uppercase", input: "world", expectOutput: "WORLD" },
  ];
  await writeFile(options.fixturePath, JSON.stringify(expectedFixture));
  await testExtension(options, dependency);
  assert.deepEqual(calls, ["validate", "test", "test"]);
  await assert.rejects(
    testExtension({ ...options, fixturePath: undefined }, dependency),
    /fixture/,
  );
});

test("CLI 只接受完整、唯一且适用于动词的参数", () => {
  assert.equal(
    parseArguments(["validate", "--manifest", "m", "--wasm", "w"]).command,
    "validate",
  );
  assert.equal(
    parseArguments(["pack", "--manifest", "m", "--wasm", "w", "--out", "o"])
      .options.outputPath,
    "o",
  );
  for (const args of [
    [],
    ["test", "--manifest", "m", "--wasm", "w"],
    ["validate", "--manifest", "m", "--wasm", "w", "--out", "o"],
    ["pack", "--manifest", "m", "--wasm", "w", "--out", "o", "--out", "x"],
    ["validate", "--manifest", "--wasm", "w"],
  ])
    assert.throws(() => parseArguments(args));
});

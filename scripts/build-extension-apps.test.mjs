import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildExtensionApps } from "./build-extension-apps.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t, modules = { "src/lib.rs": "fn main() {}\n" }) {
  const root = await mkdtemp(join(tmpdir(), "starter-demo-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = {};
  for (const [name, path, content] of [
    ["Cargo.toml", "examples/extensions/apps/Cargo.toml", "[package]\n"],
    ["Cargo.lock", "examples/extensions/apps/Cargo.lock", "version = 4\n"],
    ...Object.entries(modules).map(([name, content]) => [
      name,
      `examples/extensions/apps/${name}`,
      content,
    ]),
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
    "examples/extensions/apps/Cargo.toml",
    "examples/extensions/apps/Cargo.lock",
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

test("递归跟踪 Rust 子模块，新增、删除或修改模块都使分发资源过期", async (t) => {
  const root = await fixture(t, {
    "src/lib.rs": "mod games;\n",
    "src/games/mod.rs": "mod puzzle;\n",
    "src/games/puzzle.rs": "pub fn answer() -> u8 { 42 }\n",
  });
  await buildExtensionApps(root, { check: true });
  const module = join(root, "examples/extensions/apps/src/games/puzzle.rs");
  const original = await readFile(module);
  await writeFile(module, "pub fn answer() -> u8 { 43 }\n");
  await assert.rejects(buildExtensionApps(root, { check: true }), /请运行/);
  await writeFile(module, original);

  const added = join(root, "examples/extensions/apps/src/games/new.rs");
  await writeFile(added, "pub fn new_game() {}\n");
  await assert.rejects(buildExtensionApps(root, { check: true }), /请运行/);
  await rm(added);
  await rename(module, `${module}.removed`);
  await assert.rejects(buildExtensionApps(root, { check: true }), /请运行/);
  await rename(`${module}.removed`, module);
  await buildExtensionApps(root, { check: true });
});

test("构建回执按路径稳定排序，重建检查比较实际编译结果且不改写资源", async (t) => {
  const root = await fixture(t, {
    "src/lib.rs": "mod z; mod a;\n",
    "src/z.rs": "pub fn z() {}\n",
    "src/a/nested.rs": "pub fn a() {}\n",
  });
  const output = join(root, "resources/extensions/demo-apps.wasm");
  const receipt = join(root, "resources/extensions/demo-apps.json");
  const wasm = await readFile(output);
  const compile = async (buildRoot) => {
    assert.equal(buildRoot, root);
    return wasm;
  };
  await buildExtensionApps(root, {}, { compile });
  const committed = await readFile(receipt, "utf8");
  const keys = Object.keys(JSON.parse(committed).sources);
  assert.deepEqual(keys, [...keys].sort());
  await buildExtensionApps(root, { check: true, rebuild: true }, { compile });
  await assert.rejects(
    buildExtensionApps(
      root,
      { check: true, rebuild: true },
      { compile: async () => Buffer.from("different wasm") },
    ),
    /Wasm 不一致/,
  );
  assert.deepEqual(await readFile(output), wasm);
  assert.equal(await readFile(receipt, "utf8"), committed);
});

test("构建或重建期间子模块变化时保留原分发资源与回执", async (t) => {
  const root = await fixture(t);
  const output = join(root, "resources/extensions/demo-apps.wasm");
  const receipt = join(root, "resources/extensions/demo-apps.json");
  const wasm = await readFile(output);
  const committed = await readFile(receipt);
  for (const options of [{}, { check: true, rebuild: true }]) {
    const added = join(root, "examples/extensions/apps/src/new.rs");
    await assert.rejects(
      buildExtensionApps(root, options, {
        compile: async () => {
          await writeFile(added, "pub fn new_game() {}\n");
          return wasm;
        },
      }),
      /构建期间/,
    );
    assert.deepEqual(await readFile(output), wasm);
    assert.deepEqual(await readFile(receipt), committed);
    await rm(added);
  }
});

test("源码子目录和祖先目录中的链接均被拒绝，不读取树外 Rust 文件", async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "starter-demo-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "external.rs"), "pub fn external() {}\n");
  const src = join(root, "examples/extensions/apps/src");
  const linked = join(src, "linked");
  const directoryLink = process.platform === "win32" ? "junction" : "dir";
  await symlink(outside, linked, directoryLink);
  await assert.rejects(buildExtensionApps(root, { check: true }), /链接/);
  await rm(linked);

  await rename(src, `${src}-real`);
  await symlink(`${src}-real`, src, directoryLink);
  await assert.rejects(buildExtensionApps(root, { check: true }), /链接/);
});

test("重建验证必须显式选择检查模式", async (t) => {
  const root = await fixture(t);
  await assert.rejects(buildExtensionApps(root, { rebuild: true }), /--check/);
});

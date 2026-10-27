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
import { dirname, join, sep } from "node:path";
import test from "node:test";
import {
  buildExtensionApps,
  extensionAppsEnvironment,
  extensionAppsRemapRules,
} from "./build-extension-apps.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t, modules = { "src/lib.rs": "fn main() {}\n" }) {
  const root = await mkdtemp(join(tmpdir(), "starter-demo-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = {};
  for (const [name, path, content] of [
    ["Cargo.toml", "examples/extensions/apps/Cargo.toml", "[package]\n"],
    ["Cargo.lock", "examples/extensions/apps/Cargo.lock", "version = 4\n"],
    [
      "ui/main.html",
      "examples/extensions/apps/ui/main.html",
      "<!doctype html>\n<title>Local workspace</title>\n",
    ],
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
      "extension-apps-recipe.mjs",
      "scripts/extension-apps-recipe.mjs",
      "// Fixed build rules fixture\n",
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
  await writeFile(
    join(root, "scripts/build-extension-apps.mjs"),
    "// CLI and reporting fixture\n",
  );
  const resources = join(root, "resources/extensions");
  await mkdir(resources, { recursive: true });
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await writeFile(join(resources, "demo-apps.wasm"), wasm);
  // Receipt property order and checkout line endings do not affect freshness.
  await writeFile(
    join(resources, "demo-apps.json"),
    JSON.stringify({
      referenceHost: "x86_64-pc-windows-msvc",
      sources: Object.fromEntries(Object.entries(sources).reverse()),
      sha256: digest(wasm),
    }),
  );
  return root;
}

test("快速检查接受等效换行和收据顺序，但拒绝源码、编译规则、工具链与模块漂移", async (t) => {
  const root = await fixture(t);
  await buildExtensionApps(root, { check: true });
  for (const path of [
    "examples/extensions/apps/Cargo.toml",
    "examples/extensions/apps/Cargo.lock",
    "examples/extensions/apps/src/lib.rs",
    "examples/extensions/apps/ui/main.html",
    "examples/extensions/apps/extension.json",
    "rust-toolchain.toml",
    "scripts/extension-apps-recipe.mjs",
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

test("入口脚本的 CLI、检查与报告文案变更不要求重建模块", async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, "scripts/build-extension-apps.mjs"),
    '// Updated CLI help and reporting logic\nconsole.log("Updated check output");\n',
  );
  await buildExtensionApps(root, { check: true });
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

test("构建或重建期间界面文档变化时保留原分发资源与回执", async (t) => {
  const root = await fixture(t),
    ui = join(root, "examples/extensions/apps/ui/main.html"),
    output = join(root, "resources/extensions/demo-apps.wasm"),
    receipt = join(root, "resources/extensions/demo-apps.json");
  const original = await readFile(ui),
    wasm = await readFile(output),
    committed = await readFile(receipt);
  for (const options of [{}, { check: true, rebuild: true }]) {
    await assert.rejects(
      buildExtensionApps(root, options, {
        compile: async () => {
          await writeFile(ui, "<!doctype html><title>Changed UI</title>\n");
          return wasm;
        },
      }),
      /构建期间/,
    );
    assert.deepEqual(await readFile(output), wasm);
    assert.deepEqual(await readFile(receipt), committed);
    await writeFile(ui, original);
  }
});

test("界面文档须是普通文件，界面目录不能经过链接", async (t) => {
  const root = await fixture(t),
    ui = join(root, "examples/extensions/apps/ui"),
    document = join(ui, "main.html");
  await rename(document, `${document}.saved`);
  await mkdir(document);
  await assert.rejects(buildExtensionApps(root, { check: true }), /普通文件/);
  await rm(document, { recursive: true });
  await rename(`${document}.saved`, document);

  const real = `${ui}-real`;
  await rename(ui, real);
  await symlink(real, ui, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildExtensionApps(root, { check: true }), /链接/);
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
  await assert.rejects(
    buildExtensionApps(root, { compileCheck: true }),
    /--check/,
  );
  await assert.rejects(
    buildExtensionApps(root, {
      check: true,
      rebuild: true,
      compileCheck: true,
    }),
    /不能同时/,
  );
});

test("显式跨平台编译保留参考资源，严格重建仍拒绝字节差异", async (t) => {
  const root = await fixture(t),
    output = join(root, "resources/extensions/demo-apps.wasm"),
    receipt = join(root, "resources/extensions/demo-apps.json");
  const committed = await readFile(output),
    originalReceipt = await readFile(receipt);
  const calls = [];
  const compile = async (_root, options) => {
    calls.push(options);
    return Buffer.from("different host output");
  };
  assert.match(
    await buildExtensionApps(
      root,
      { check: true, compileCheck: true },
      { compile },
    ),
    /不作跨构建平台逐字节一致断言/,
  );
  await assert.rejects(
    buildExtensionApps(root, { check: true, rebuild: true }, { compile }),
    /Wasm 不一致/,
  );
  assert.deepEqual(calls, [{ referenceOnly: false }, { referenceOnly: true }]);
  assert.deepEqual(await readFile(output), committed);
  assert.deepEqual(await readFile(receipt), originalReceipt);
  const changed = JSON.parse(originalReceipt);
  changed.referenceHost = "different-host";
  await writeFile(receipt, JSON.stringify(changed));
  await assert.rejects(buildExtensionApps(root, { check: true }), /参考平台/);
});

test("编译环境只使用生成的路径规则，清除大小写变体的自定义 flags 与 wrapper", () => {
  assert.deepEqual(
    extensionAppsEnvironment(
      {
        PATH: "/tools",
        CARGO_HOME: "/cache",
        RUSTFLAGS: "-C opt-level=0",
        cargo_encoded_rustflags: "untrusted",
        Cargo_Build_Rustflags: "untrusted",
        CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: "untrusted",
        RUSTC: "/different/compiler",
        Rustc_Wrapper: "/wrapper",
        RUSTC_WORKSPACE_WRAPPER: "/wrapper",
        CARGO_PROFILE_RELEASE_LTO: "false",
        OTHER: "kept",
      },
      "/checkout with spaces/flags.txt",
    ),
    {
      PATH: "/tools",
      CARGO_HOME: "/cache",
      OTHER: "kept",
      CARGO_ENCODED_RUSTFLAGS: "@/checkout with spaces/flags.txt",
    },
  );
});

test("目录映射去除本机依赖来源并包含分隔符，使目标路径稳定且不超过命令行额度", async (t) => {
  const root = await fixture(t),
    app = join(root, "examples/extensions/apps");
  const dependency = join(root, "registry-hash", "fixture-dependency-1.2.3");
  await mkdir(join(dependency, "src", "nested"), { recursive: true });
  await writeFile(
    join(dependency, "src", "nested", "module.rs"),
    "pub fn value() {}\n",
  );
  const commit = "a".repeat(40),
    sysroot = join(root, "machine toolchain");
  const rules = await extensionAppsRemapRules(
    [
      {
        name: "starter-extism-apps",
        version: "2.2.1",
        manifest_path: join(app, "Cargo.toml"),
      },
      {
        name: "fixture-dependency",
        version: "1.2.3",
        manifest_path: join(dependency, "Cargo.toml"),
      },
    ],
    sysroot,
    commit,
  );
  assert.ok(rules.includes(`--remap-path-prefix=src${sep}=/app/src/`));
  assert.ok(
    rules.includes(
      `--remap-path-prefix=${join(dependency, "src", "nested")}${sep}=/cargo/fixture-dependency-1.2.3/src/nested/`,
    ),
  );
  assert.ok(rules.some((rule) => rule.endsWith(`=/rustc/${commit}/library/`)));
  for (const rule of rules) {
    const destination = rule.slice(rule.lastIndexOf("=") + 1);
    assert.ok(destination.startsWith("/"));
    assert.ok(destination.endsWith("/"));
    assert.equal(destination.includes("\\"), false);
    assert.equal(destination.includes("registry-hash"), false);
  }
  await assert.rejects(
    extensionAppsRemapRules([], sysroot, "unknown"),
    /编译器提交/,
  );
});

test("构建规则的 root 内祖先目录链接同样被拒绝", async (t) => {
  const root = await fixture(t),
    scripts = join(root, "scripts"),
    real = `${scripts}-real`;
  await rename(scripts, real);
  await symlink(
    real,
    scripts,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(buildExtensionApps(root, { check: true }), /链接/);
});

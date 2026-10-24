import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  readdir,
  realpath,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";

const source = "examples/extensions/apps/";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function inside(root, path) {
  const offset = relative(root, path);
  return (
    offset !== "" &&
    offset !== ".." &&
    !offset.startsWith(`..${sep}`) &&
    !isAbsolute(offset)
  );
}

async function sourceEntry(root, path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !inside(root, await realpath(path)))
    throw new Error(`内置插件源码不得经过目录或文件链接：${path}`);
  return metadata;
}

async function sourceHashes(root) {
  root = await realpath(root);
  let directory = root;
  for (const part of source.split("/").filter(Boolean)) {
    directory = join(directory, part);
    if (!(await sourceEntry(root, directory)).isDirectory())
      throw new Error(`内置插件源码需要普通目录：${directory}`);
  }
  const files = ["Cargo.toml", "Cargo.lock", "extension.json"].map((file) => [
    file,
    join(root, source, file),
  ]);
  files.push(["rust-toolchain.toml", join(root, "rust-toolchain.toml")]);

  async function rustSources(path, name) {
    const metadata = await sourceEntry(root, path);
    if (metadata.isDirectory()) {
      for (const entry of (await readdir(path)).sort())
        await rustSources(join(path, entry), `${name}/${entry}`);
    } else if (name.endsWith(".rs")) {
      if (!metadata.isFile())
        throw new Error(`内置插件源码需要普通文件：${path}`);
      files.push([name, path]);
    }
  }
  const rustDirectory = join(directory, "src");
  if (!(await sourceEntry(root, rustDirectory)).isDirectory())
    throw new Error(`内置插件源码需要普通目录：${rustDirectory}`);
  await rustSources(rustDirectory, "src");
  files.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(
    await Promise.all(
      files.map(async ([name, path]) => {
        if (!(await sourceEntry(root, path)).isFile())
          throw new Error(`内置插件构建输入需要普通文件：${path}`);
        return [
          name,
          hash((await readFile(path, "utf8")).replace(/\r\n/g, "\n")),
        ];
      }),
    ),
  );
}

function sameSources(expected, sources) {
  return (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    Object.keys(expected).length === Object.keys(sources).length &&
    Object.entries(sources).every(([name, value]) => expected[name] === value)
  );
}

async function compileDemo(root) {
  const { toolchain } = parseToml(
    await readFile(join(root, "rust-toolchain.toml"), "utf8"),
  );
  const result = spawnSync(
    "cargo",
    [
      `+${toolchain.channel}`,
      "build",
      "--manifest-path",
      join(root, source, "Cargo.toml"),
      "--release",
      "--locked",
      "--target",
      "wasm32-unknown-unknown",
      "--target-dir",
      join(root, "src-tauri/target/extension-apps"),
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("内置插件构建失败，请先安装 wasm32-unknown-unknown 目标");
  return readFile(
    join(
      root,
      "src-tauri/target/extension-apps/wasm32-unknown-unknown/release/starter_extism_apps.wasm",
    ),
  );
}

export async function buildExtensionApps(
  root,
  { check = false, rebuild = false } = {},
  { compile = compileDemo } = {},
) {
  if (rebuild && !check) throw new Error("--rebuild 需要与 --check 一起使用");
  const sources = await sourceHashes(root);
  const output = join(root, "resources/extensions/demo-apps.wasm");
  const receipt = join(root, "resources/extensions/demo-apps.json");
  if (check) {
    const expected = JSON.parse(await readFile(receipt, "utf8"));
    const committed = await readFile(output);
    if (
      !sameSources(expected.sources, sources) ||
      expected.sha256 !== hash(committed)
    )
      throw new Error(
        "内置插件源码、工具链或模块变化，请运行 pnpm extension:demos:build 并提交资源",
      );
    if (rebuild) {
      const rebuilt = await compile(root);
      if (!sameSources(sources, await sourceHashes(root)))
        throw new Error("构建期间内置插件源码发生变化，请重新构建");
      if (!committed.equals(rebuilt))
        throw new Error("重建的内置插件与提交的 Wasm 不一致，请重建并提交资源");
    }
    return rebuild
      ? "内置插件重建结果与提交资源一致。"
      : "内置插件源码与分发资源一致。";
  }
  const wasm = await compile(root);
  // Do not associate a successful build with sources edited while Cargo was running.
  if (!sameSources(sources, await sourceHashes(root)))
    throw new Error("构建期间内置插件源码发生变化，请重新构建");
  await mkdir(join(root, "resources/extensions"), { recursive: true });
  await writeFile(output, wasm);
  await writeFile(
    receipt,
    JSON.stringify({ sources, sha256: hash(wasm) }, null, 2) + "\n",
  );
  return `已生成内置插件：${wasm.length} 字节。`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !["--check", "--rebuild"].includes(arg)) ||
    new Set(args).size !== args.length
  )
    throw new Error(
      "Usage: node scripts/build-extension-apps.mjs [--check [--rebuild]]",
    );
  console.log(
    await buildExtensionApps(resolve(import.meta.dirname, ".."), {
      check: args.includes("--check"),
      rebuild: args.includes("--rebuild"),
    }),
  );
}

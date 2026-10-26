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
import { resolve, join, relative, isAbsolute, sep, dirname } from "node:path";
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
  if (!(await sourceEntry(root, join(root, "scripts"))).isDirectory())
    throw new Error("内置插件构建规则需要普通目录");
  files.push([
    "build-extension-apps.mjs",
    join(root, "scripts/build-extension-apps.mjs"),
  ]);

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

export function extensionAppsEnvironment(
  environment = process.env,
  responseFile,
) {
  const clean = Object.fromEntries(
    Object.entries(environment).filter(([name]) => {
      const upper = name.toUpperCase();
      return (
        ![
          "RUSTFLAGS",
          "CARGO_ENCODED_RUSTFLAGS",
          "RUSTC",
          "RUSTC_WRAPPER",
          "RUSTC_WORKSPACE_WRAPPER",
        ].includes(upper) &&
        !/^CARGO_(?:BUILD|TARGET_[A-Z0-9_]+)_RUSTFLAGS$/.test(upper) &&
        !upper.startsWith("CARGO_PROFILE_RELEASE_")
      );
    }),
  );
  return {
    ...clean,
    CARGO_ENCODED_RUSTFLAGS: responseFile ? `@${responseFile}` : "",
  };
}

/** Directory prefixes include the separator so Windows suffixes also become portable. */
export async function extensionAppsRemapRules(packages, sysroot, rustcCommit) {
  if (!/^[a-f0-9]{40}$/.test(rustcCommit))
    throw new Error("无法识别固定 Rust 编译器提交");
  const rules = new Map();
  function add(from, to) {
    if (/[\r\n]/.test(from)) throw new Error("内置插件构建路径不能包含换行");
    rules.set(from, to);
  }
  for (const pkg of packages) {
    const directory = dirname(pkg.manifest_path),
      local = pkg.name === "starter-extism-apps";
    const prefix = local ? "/app/" : `/cargo/${pkg.name}-${pkg.version}/`;
    add(`${directory}${sep}`, prefix);
    async function visit(path) {
      const offset = relative(directory, path),
        portable = offset.split(sep).join("/");
      const entries = await readdir(path, { withFileTypes: true });
      if (
        entries.some((entry) => entry.isFile() && entry.name.endsWith(".rs"))
      ) {
        const destination = prefix + (portable ? `${portable}/` : "");
        add(`${path}${sep}`, destination);
        if (local && offset) add(`${offset}${sep}`, destination);
      }
      for (const entry of entries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      ))
        if (entry.isDirectory() && !["target", ".git"].includes(entry.name))
          await visit(join(path, entry.name));
    }
    await visit(directory);
  }
  const rustSource = [
    "lib/rustlib/src/rust",
    ["lib", "rustlib", "src", "rust"].join(sep),
  ];
  for (const first of new Set([sep, "/"]))
    for (const path of new Set(rustSource))
      for (const boundary of new Set([sep, "/"]))
        for (const trailing of new Set([sep, "/"]))
          add(
            `${sysroot}${first}${path}${boundary}library${trailing}`,
            `/rustc/${rustcCommit}/library/`,
          );
  return [...rules]
    .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([from, to]) => `--remap-path-prefix=${from}=${to}`);
}

async function compileDemo(root) {
  const { toolchain } = parseToml(
    await readFile(join(root, "rust-toolchain.toml"), "utf8"),
  );
  const environment = extensionAppsEnvironment();
  function inspect(executable, args) {
    const result = spawnSync(executable, args, {
      cwd: root,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(result.stderr?.trim() || "无法读取固定 Rust 构建元数据");
    return result.stdout;
  }
  const tool = `+${toolchain.channel}`;
  const sysroot = inspect("rustc", [tool, "--print", "sysroot"]).trim();
  const commit = inspect("rustc", [tool, "-vV"]).match(
    /^commit-hash: ([a-f0-9]{40})$/m,
  )?.[1];
  const metadata = JSON.parse(
    inspect("cargo", [
      tool,
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      join(root, source, "Cargo.toml"),
    ]),
  );
  const target = join(root, "src-tauri/target/extension-apps");
  await mkdir(target, { recursive: true });
  const rules =
    (await extensionAppsRemapRules(metadata.packages, sysroot, commit)).join(
      "\n",
    ) + "\n";
  const responseFile = join(target, `rustc-flags-${hash(rules)}.txt`);
  try {
    await writeFile(responseFile, rules, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if ((await readFile(responseFile, "utf8")) !== rules)
      throw new Error("固定的内置插件编译规则文件内容不一致", { cause: error });
  }
  const result = spawnSync(
    "cargo",
    [
      tool,
      "build",
      "--manifest-path",
      join(root, source, "Cargo.toml"),
      "--release",
      "--locked",
      "--target",
      "wasm32-unknown-unknown",
      "--target-dir",
      target,
    ],
    {
      cwd: root,
      env: extensionAppsEnvironment(process.env, responseFile),
      stdio: "inherit",
      windowsHide: true,
    },
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

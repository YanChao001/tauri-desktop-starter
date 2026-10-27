import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative, sep, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";

export const extensionAppsSource = "examples/extensions/apps/";
export const extensionAppsReferenceHost = "x86_64-pc-windows-msvc";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

export async function compileDemo(root, { referenceOnly = false } = {}) {
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
  const version = inspect("rustc", [tool, "-vV"]);
  if (
    referenceOnly &&
    version.match(/^host: (.+)$/m)?.[1].trim() !== extensionAppsReferenceHost
  )
    throw new Error(
      `内置分发资源与逐字节重建需要参考构建平台 ${extensionAppsReferenceHost}；其他平台使用 --check --compile`,
    );
  const commit = version.match(/^commit-hash: ([a-f0-9]{40})$/m)?.[1];
  const metadata = JSON.parse(
    inspect("cargo", [
      tool,
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      join(root, extensionAppsSource, "Cargo.toml"),
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
      join(root, extensionAppsSource, "Cargo.toml"),
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

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Windows 环境变量不区分大小写；避免同时传入 Path 与 PATH。 */
export function buildEnvironment(source = process.env) {
  const env = { ...source };
  const pathKeys = Object.keys(env).filter((key) => /^path$/i.test(key));
  const searchPath = pathKeys.map((key) => env[key]).filter(Boolean);
  for (const key of pathKeys) delete env[key];
  const cargoBin = join(source.CARGO_HOME ?? join(homedir(), ".cargo"), "bin");
  if (existsSync(join(cargoBin, "cargo.exe"))) searchPath.unshift(cargoBin);
  env.PATH = searchPath.join(";");
  return env;
}

function fileName(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    /[<>:"/\\|?*]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(value) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  ) {
    throw new Error(`${label} 不是有效的 Windows 文件名：${value}`);
  }
  return value;
}

/** 使用 Cargo 的真实输出目录，兼容 CARGO_TARGET_DIR 与 .cargo/config.toml。 */
export function portablePaths(root, config, metadata, target) {
  if (typeof target !== "string" || !/^[a-zA-Z0-9_-]+$/.test(target)) {
    throw new Error("无法确定本机 Rust target");
  }
  const manifest = resolve(root, "src-tauri/Cargo.toml");
  const pkg = metadata.packages.find(
    (entry) => resolve(entry.manifest_path) === manifest,
  );
  if (!pkg) throw new Error("cargo metadata 中没有找到应用 package");
  const binaries = pkg.targets.filter((target) => target.kind.includes("bin"));
  const binary = pkg.default_run
    ? binaries.find((target) => target.name === pkg.default_run)
    : (binaries.find((target) => target.name === pkg.name) ??
      (binaries.length === 1 ? binaries[0] : undefined));
  if (!binary)
    throw new Error("无法确定主程序，请设置 Cargo.toml 的 default-run");
  const productName = fileName(config.productName ?? pkg.name, "productName");
  const binaryName = fileName(config.mainBinaryName ?? binary.name, "主程序名");
  return {
    productName,
    builtExe: join(
      metadata.target_directory,
      target,
      "release",
      `${binaryName}.exe`,
    ),
    portableExe: join(root, "dist-portable", `${productName}.exe`),
  };
}

export function assertSeparateOutput(source, output) {
  if (!existsSync(output)) return;
  const offset = relative(realpathSync(output), realpathSync(source));
  if (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  ) {
    throw new Error(
      "Cargo 产物位于 dist-portable 中，拒绝清理源文件；请使用其他 target-dir",
    );
  }
}

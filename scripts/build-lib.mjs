import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { checkVersions } from "./version.mjs";

const require = createRequire(import.meta.url);
const ADVANCED = "高级构建请使用 pnpm tauri build；该命令不自动归档分发文件。";
const BUNDLE_DIRECTORIES = new Set([
  "nsis",
  "msi",
  "dmg",
  "macos",
  "deb",
  "rpm",
  "appimage",
  "updater",
]);

/** GUI 和 CI 中也能找到 rustup，同时保留各平台 PATH 的大小写规则。 */
export function buildEnvironment(source = process.env) {
  const env = { ...source };
  const pathKeys =
    process.platform === "win32"
      ? Object.keys(env).filter((key) => /^path$/i.test(key))
      : ["PATH"];
  const searchPath = pathKeys.map((key) => env[key]).filter(Boolean);
  for (const key of pathKeys) delete env[key];
  const cargoBin = join(source.CARGO_HOME ?? join(homedir(), ".cargo"), "bin");
  if (
    existsSync(
      join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo"),
    )
  ) {
    searchPath.unshift(cargoBin);
  }
  env.PATH = searchPath.join(delimiter);
  return env;
}

function optionError(message) {
  throw new Error(`${message}\n${ADVANCED}`);
}

/** 包装器只支持能在 build 与 bundle 两阶段保持一致的 release 参数。 */
export function parseBuildArgs(args) {
  const options = {
    target: undefined,
    configs: [],
    bundles: [],
    common: [],
    noBundle: false,
  };
  const singles = new Set(["--target", "-t", "--config", "-c"]);
  const lists = new Set(["--bundles", "-b", "--features", "-f"]);
  const flags = new Set([
    "--ci",
    "--no-sign",
    "--skip-stapling",
    "--no-binary-patching",
    "--verbose",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equal = arg.indexOf("=");
    const key = equal === -1 ? arg : arg.slice(0, equal);
    if (arg === "--no-bundle") {
      options.noBundle = true;
      continue;
    }
    if (flags.has(arg) || /^-v+$/.test(arg)) {
      options.common.push(arg);
      continue;
    }
    if (!singles.has(key) && !lists.has(key))
      optionError(`app:build 不支持参数：${arg}`);
    const values = [];
    if (equal !== -1) {
      values.push(arg.slice(equal + 1));
    } else {
      while (index + 1 < args.length && !args[index + 1].startsWith("-")) {
        values.push(args[++index]);
        if (singles.has(key)) break;
      }
    }
    if (!values.length || values.some((value) => !value.trim()))
      optionError(`${key} 缺少参数值`);
    if (key === "--target" || key === "-t") {
      if (options.target) optionError("--target 只能指定一次");
      options.target = values[0];
      if (
        !/^[a-zA-Z0-9_-]+$/.test(options.target) ||
        options.target === "universal-apple-darwin"
      ) {
        optionError(
          "app:build 不支持自定义 JSON target 或 universal-apple-darwin",
        );
      }
    }
    if (key === "--config" || key === "-c") options.configs.push(values[0]);
    if (key === "--bundles" || key === "-b")
      options.bundles.push(...values.flatMap((value) => value.split(",")));
    options.common.push(key, ...values);
  }
  return options;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC 7396：对象递归合并，数组替换，null 删除字段。 */
export function mergeConfig(base, patch) {
  if (!object(patch)) return structuredClone(patch);
  const result = object(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      const previous = Object.hasOwn(result, key) ? result[key] : undefined;
      Object.defineProperty(result, key, {
        value: mergeConfig(previous, value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}

function readJsonConfig(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!object(config)) optionError(`配置必须是 JSON 对象：${path}`);
  return config;
}

function platformForTarget(target) {
  if (target.includes("-windows-")) return "windows";
  if (target.endsWith("-apple-darwin")) return "macos";
  if (target.includes("-linux-") && !target.includes("android")) return "linux";
  optionError(`app:build 仅支持桌面目标平台：${target}`);
}

function safeBinaryName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\\0]/.test(name)
  ) {
    throw new Error("主程序名称必须是单个文件名");
  }
  return name;
}

/** 统一版本、JSON 配置与 Cargo 元数据；不解析或覆盖 Cargo 的 target 设置。 */
export function prepareBuild(
  root,
  args = [],
  { env = buildEnvironment() } = {},
) {
  root = resolve(root);
  const options = parseBuildArgs(args);
  const host = execFileSync("rustc", ["-vV"], {
    cwd: root,
    env,
    encoding: "utf8",
  })
    .match(/^host: (.+)$/m)?.[1]
    ?.trim();
  if (!host) throw new Error("无法读取 rustc 的 host target");
  const target = options.target ?? host;
  const platform = platformForTarget(target);
  const version = checkVersions(root);
  const tauriDir = join(root, "src-tauri");
  const config = effectiveConfig(root, options, version, platform);
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--no-deps", "--locked", "--format-version", "1"],
      {
        cwd: tauriDir,
        env,
        encoding: "utf8",
      },
    ),
  );
  const manifest = realpathSync(join(tauriDir, "Cargo.toml"));
  const pkg = metadata.packages.find(
    (entry) => realpathSync(entry.manifest_path) === manifest,
  );
  if (!pkg) throw new Error("cargo metadata 中没有找到应用 package");
  const binaries = pkg.targets.filter((entry) => entry.kind.includes("bin"));
  const binary = pkg.default_run
    ? binaries.find((entry) => entry.name === pkg.default_run)
    : (binaries.find((entry) => entry.name === pkg.name) ??
      (binaries.length === 1 ? binaries[0] : undefined));
  if (!binary)
    throw new Error("无法确定主程序，请在 Cargo.toml 设置 default-run");
  safeBinaryName(config.mainBinaryName ?? binary.name);
  const targets = options.bundles.length
    ? options.bundles
    : (config.bundle?.targets ?? "all");
  const noBundle =
    options.noBundle ||
    (!(config.bundle?.active ?? false) && !options.bundles.length) ||
    (Array.isArray(targets) && targets.length === 0);
  return {
    root,
    env,
    version,
    config,
    metadata,
    package: pkg,
    binary,
    host,
    target,
    platform,
    noBundle,
    explicitTarget: options.target,
    buildArgs: [
      ...options.common,
      "--no-bundle",
      "--",
      "--message-format=json",
    ],
    bundleArgs: options.common,
  };
}

export function effectiveConfig(root, options, version, platform) {
  const tauriDir = join(root, "src-tauri");
  let config = readJsonConfig(join(tauriDir, "tauri.conf.json"));
  const platformConfig = join(tauriDir, `tauri.${platform}.conf.json`);
  if (existsSync(platformConfig)) {
    config = mergeConfig(config, readJsonConfig(platformConfig));
  } else if (
    existsSync(`${platformConfig}5`) ||
    existsSync(join(tauriDir, `Tauri.${platform}.toml`))
  ) {
    optionError(
      "app:build 仅支持 JSON 格式的平台配置，不能忽略 JSON5/TOML 配置",
    );
  }
  for (const value of options.configs) {
    let patch;
    if (value.trimStart().startsWith("{")) {
      patch = JSON.parse(value);
      if (!object(patch)) optionError("--config 必须是 JSON 对象");
    } else {
      if (extname(value).toLowerCase() !== ".json")
        optionError("--config 仅支持 JSON 文件或 JSON 对象字符串");
      patch = readJsonConfig(resolve(root, value));
    }
    config = mergeConfig(config, patch);
  }
  if (config.version !== version) {
    optionError(
      `生效配置版本 ${config.version} 与项目版本 ${version} 不一致，请使用 pnpm version:set 同步版本`,
    );
  }
  return config;
}

function contained(root, path) {
  const offset = relative(root, path);
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}

/** 只接收主 package / 主 binary 的 Cargo 消息，缓存命中时同样有效。 */
export function cargoExecutable(message, plan) {
  return message.reason === "compiler-artifact" &&
    message.package_id === plan.package.id &&
    message.target?.name === plan.binary.name &&
    message.target?.kind?.includes("bin") &&
    typeof message.executable === "string"
    ? message.executable
    : undefined;
}

function runTauri(plan, command, args, collect = false) {
  return new Promise((resolveResult, reject) => {
    const artifacts = new Set();
    const child = spawn(
      process.execPath,
      [require.resolve("@tauri-apps/cli/tauri.js"), command, ...args],
      {
        cwd: plan.root,
        env: plan.env,
        stdio: ["inherit", "pipe", "inherit"],
      },
    );
    let interrupted;
    const interrupt = (signal) => {
      interrupted = signal;
      child.kill(process.platform === "win32" ? "SIGTERM" : signal);
    };
    const onInterrupt = () => interrupt("SIGINT");
    const onTerminate = () => interrupt("SIGTERM");
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    const removeSignalHandlers = () => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    };
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (collect) {
        try {
          const message = JSON.parse(line);
          const executable = cargoExecutable(message, plan);
          if (executable) artifacts.add(executable);
          if (message.reason === "compiler-message") {
            if (message.message?.rendered)
              process.stderr.write(message.message.rendered);
            return;
          }
          if (
            [
              "compiler-artifact",
              "build-script-executed",
              "build-finished",
            ].includes(message.reason)
          )
            return;
        } catch {
          // 构建钩子的普通 stdout 保持可见，不要求它们输出 JSON
        }
      }
      process.stdout.write(`${line}\n`);
    });
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("close", (code, signal) => {
      removeSignalHandlers();
      if (code === 0 && !interrupted) resolveResult([...artifacts]);
      else {
        signal = interrupted ?? signal;
        const error = new Error(
          `tauri ${command} 失败${signal ? `（${signal}）` : `（退出码 ${code}）`}`,
        );
        error.exitCode = interrupted
          ? interrupted === "SIGINT"
            ? 130
            : 143
          : (code ?? 1);
        reject(error);
      }
    });
  });
}

export function locateBuildOutput(plan, executables) {
  const paths = [...new Set(executables)];
  if (paths.length !== 1)
    throw new Error(
      `Cargo 必须恰好返回一个主程序路径，实际为 ${paths.length} 个`,
    );
  const outputDir = realpathSync(dirname(paths[0]));
  const targetDirectory = realpathSync(plan.metadata.target_directory);
  if (!contained(targetDirectory, outputDir) || outputDir === targetDirectory) {
    throw new Error("Cargo 主程序输出路径超出 target_directory");
  }
  const parts = relative(targetDirectory, outputDir).split(sep);
  if (parts.at(-1) !== "release" || parts.length > 2)
    optionError("无法确认 release 构建输出目录");
  const target = parts.length === 2 ? parts[0] : plan.host;
  const platform = platformForTarget(target);
  if (plan.explicitTarget && target !== plan.explicitTarget)
    throw new Error("Cargo 输出的 target 与请求不一致");
  if (platform !== plan.platform) {
    optionError(
      "Cargo 隐式 target 改变了目标操作系统，请使用 --target 明确指定，确保平台配置一致",
    );
  }
  const executable = join(
    outputDir,
    `${safeBinaryName(plan.config.mainBinaryName ?? plan.binary.name)}${platform === "windows" ? ".exe" : ""}`,
  );
  if (!statSync(executable).isFile())
    throw new Error(`主程序不存在：${executable}`);
  return { executable, outputDir, target };
}

export async function buildApplication(plan) {
  const executables = await runTauri(plan, "build", plan.buildArgs, true);
  return locateBuildOutput(plan, executables);
}

function bundleExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function verifyBundleParent(plan, built) {
  const outputDir = realpathSync(built.outputDir);
  const targetDirectory = realpathSync(plan.metadata.target_directory);
  if (outputDir === targetDirectory || !contained(targetDirectory, outputDir))
    throw new Error("拒绝操作 target_directory 以外的 bundle");
  return outputDir;
}

/** 只遍历 Tauri 已知分发目录，保留安装器类型层次，不收集构建脚本或裸 exe。 */
export function installerEntries(bundleDir) {
  const entries = [];
  for (const directory of readdirSync(bundleDir, { withFileTypes: true })) {
    if (!BUNDLE_DIRECTORIES.has(directory.name)) continue;
    if (directory.isSymbolicLink() || !directory.isDirectory())
      throw new Error(`bundle 类型目录无效：${directory.name}`);
    for (const entry of readdirSync(join(bundleDir, directory.name), {
      withFileTypes: true,
    })) {
      const path = join(directory.name, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`分发文件不能是目录链接：${path}`);
      if (
        (entry.isDirectory() &&
          directory.name === "macos" &&
          entry.name.endsWith(".app")) ||
        (entry.isFile() &&
          /(?:\.exe|\.msi|\.dmg|\.deb|\.rpm|\.AppImage|\.sig|\.zip|\.tar\.gz)$/i.test(
            entry.name,
          ))
      ) {
        entries.push({ source: join(bundleDir, path), path });
      }
    }
  }
  if (!entries.length)
    throw new Error("本次 Tauri bundle 没有生成受支持的分发文件");
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/** 暂存旧 bundle；只有本次打包、归档均成功后才清理备份，失败则恢复。 */
export async function bundleApplication(plan, built, consume) {
  if (plan.noBundle) return undefined;
  return withFreshBundle(
    plan,
    built,
    () => runTauri(plan, "bundle", plan.bundleArgs),
    consume,
  );
}

export async function withFreshBundle(plan, built, create, consume) {
  const outputDir = verifyBundleParent(plan, built);
  const bundleDir = join(outputDir, "bundle");
  const original = bundleExists(bundleDir);
  if (original && (original.isSymbolicLink() || !original.isDirectory()))
    throw new Error("bundle 必须是普通目录，不能通过链接覆盖其他位置");
  const staging = join(outputDir, `.starter-bundle-${randomUUID()}`);
  mkdirSync(staging);
  const previous = join(staging, "previous");
  const binaryBackup = join(staging, "main-binary");
  let isolated = false;
  let result;
  try {
    if (built.executable) {
      const executable = realpathSync(built.executable);
      if (dirname(executable) !== outputDir)
        throw new Error("主程序不在本次 Cargo 输出目录内");
      copyFileSync(executable, binaryBackup);
    }
    if (original) renameSync(bundleDir, previous);
    isolated = true;
    await create();
    const current = bundleExists(bundleDir);
    if (!current?.isDirectory() || current.isSymbolicLink())
      throw new Error("本次打包没有生成有效的 bundle 目录");
    result = await consume(installerEntries(bundleDir));
  } catch (error) {
    try {
      verifyBundleParent(plan, built);
      if (isolated) {
        if (bundleExists(bundleDir))
          renameSync(bundleDir, join(staging, "failed"));
        if (existsSync(previous)) renameSync(previous, bundleDir);
      }
      // Tauri 成功时会还原 binary patch；中途失败也必须还原，避免污染便携版缓存
      if (existsSync(binaryBackup)) {
        if (bundleExists(built.executable)?.isSymbolicLink())
          throw new Error("主程序被替换为链接，拒绝覆盖链接目标", {
            cause: error,
          });
        copyFileSync(binaryBackup, built.executable);
      }
      // staging 是本次创建的固定直接子目录，且其父目录已重新校验
      rmSync(staging, { recursive: true, force: true });
    } catch (restoreError) {
      throw new Error(
        `${error.message}\n恢复旧安装包失败：${restoreError.message}；备份保留在 ${staging}`,
        { cause: restoreError },
      );
    }
    throw error;
  }
  try {
    verifyBundleParent(plan, built);
    rmSync(staging, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `分发文件已归档，旧 bundle 备份未能清理：${staging}（${error.message}）`,
    );
  }
  return result;
}

// CI 可查询 JSON 平台配置，无需启动 Cargo。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const platform = process.argv[2];
    if (
      process.argv.length !== 3 ||
      !["windows", "macos", "linux"].includes(platform)
    )
      throw new Error("用法: node scripts/build-lib.mjs <windows|macos|linux>");
    const root = resolve(import.meta.dirname, "..");
    console.log(
      JSON.stringify(
        effectiveConfig(
          root,
          parseBuildArgs([]),
          checkVersions(root),
          platform,
        ),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

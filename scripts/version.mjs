import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyFileChanges, projectFile } from "./fs-utils.mjs";

// SemVer 2.0 的数字标识不能有前导零，构建元数据不受此限制。
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function validateVersion(version, config) {
  const match = typeof version === "string" && version.match(SEMVER);
  if (!match) throw new Error(`无效的 SemVer 版本号：${version}`);
  const core = match.slice(1, 4).map(BigInt);
  if (core.some((part) => part > 18446744073709551615n)) {
    throw new Error("版本号超出 Cargo 支持的整数范围");
  }
  const bundle = config.bundle;
  if (bundle?.active === false) return;
  const targets = bundle?.targets ?? "all";
  const includes = (target) =>
    targets === "all" ||
    targets === target ||
    targets.includes("all") ||
    targets.includes(target);
  if (includes("nsis") && core.some((part) => part > 65535n)) {
    throw new Error("NSIS 版本号各段不能大于 65535");
  }
  if (includes("msi")) {
    const wixVersion = bundle?.windows?.wix?.version;
    if (wixVersion !== undefined && wixVersion !== null) {
      const wixParts =
        typeof wixVersion === "string" &&
        wixVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
      if (
        !wixParts ||
        wixParts
          .slice(1)
          .some(
            (part, index) =>
              part !== undefined && BigInt(part) > (index < 2 ? 255n : 65535n),
          )
      ) {
        throw new Error(
          "bundle.windows.wix.version 必须是有效的 MSI 版本：major.minor.patch[.build]（255.255.65535[.65535]）",
        );
      }
      return;
    }
    if (core[0] > 255n || core[1] > 255n || core[2] > 65535n) {
      throw new Error(
        "MSI 版本号必须满足 major <= 255、minor <= 255、patch <= 65535",
      );
    }
    // Tauri 优先使用构建元数据，再使用预发布标识作为 MSI 可选的第四段。
    // 文本预发布标识需要显式配置 wix.version。
    const fourth = match[5] ?? match[4];
    if (fourth && (!/^\d+$/.test(fourth) || BigInt(fourth) > 65535n)) {
      throw new Error(
        "MSI 的预发布标识或构建元数据必须是 <= 65535 的整数；文本预发布请配置 bundle.windows.wix.version 或仅构建 NSIS",
      );
    }
  }
}

function tomlValue(content, key, label) {
  const match = content.match(
    new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\r\\n]+)"\\s*(?:#.*)?$`, "m"),
  );
  if (!match) throw new Error(`${label} 里没有找到 ${key}`);
  return match[1];
}

export function readVersionFiles(root) {
  const originals = new Map();
  const read = (path) => {
    const content = readFileSync(projectFile(root, path), "utf8");
    originals.set(path, content);
    return content;
  };
  const packagePath = "package.json";
  const configPath = "src-tauri/tauri.conf.json";
  const manifestPath = "src-tauri/Cargo.toml";
  const lockPath = "src-tauri/Cargo.lock";
  const packageJson = JSON.parse(read(packagePath));
  const config = JSON.parse(read(configPath));
  const manifest = read(manifestPath);
  const packageSection = manifest.match(
    /^\[package\][^\S\r\n]*(?:#.*)?\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m,
  );
  if (!packageSection) throw new Error("Cargo.toml 里没有找到 [package]");
  const packageName = tomlValue(packageSection[1], "name", manifestPath);
  const cargoVersion = tomlValue(packageSection[1], "version", manifestPath);
  const files = [
    { path: packagePath, version: packageJson.version, json: packageJson },
    { path: configPath, version: config.version, json: config },
    {
      path: manifestPath,
      version: cargoVersion,
      content: manifest,
      section: packageSection[0],
    },
  ];
  const lock = read(lockPath);
  const sections = lock.matchAll(
    /^\[\[package\]\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[\[|(?![\s\S]))/gm,
  );
  const ownPackages = [...sections].filter(
    (section) =>
      tomlValue(section[1], "name", lockPath) === packageName &&
      !/^\s*source\s*=/m.test(section[1]),
  );
  if (ownPackages.length !== 1) {
    throw new Error(`Cargo.lock 中必须恰好有一个本地包 ${packageName}`);
  }
  files.push({
    path: lockPath,
    version: tomlValue(ownPackages[0][1], "version", lockPath),
    content: lock,
    section: ownPackages[0][0],
  });
  for (const file of files) file.before = originals.get(file.path);
  return { config, files };
}

export function checkVersions(root, tag) {
  const { config, files } = readVersionFiles(root);
  const version = files[0].version;
  validateVersion(version, config);
  for (const file of files) {
    if (file.version !== version) {
      throw new Error(
        `${file.path} 版本 ${file.version} 与 package.json 的 ${version} 不一致`,
      );
    }
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`tag ${tag} 与项目版本 v${version} 不一致`);
  }
  return version;
}

export function prepareVersionUpdates(root, next) {
  // 写入前先解析所有文件，并校验 Windows 安装包版本。
  const { config, files } = readVersionFiles(root);
  validateVersion(next, config);
  return files.map((file) => {
    const content = file.json
      ? `${JSON.stringify({ ...file.json, version: next }, null, 2)}\n`
      : file.content.replace(
          file.section,
          file.section.replace(
            /^(\s*version\s*=\s*")[^"\r\n]+(")/m,
            (_, prefix, suffix) => `${prefix}${next}${suffix}`,
          ),
        );
    return {
      path: file.path,
      before: file.before,
      content,
      previous: file.version,
    };
  });
}

async function runCli(args) {
  const usage =
    "用法: node scripts/version.mjs check [tag] | set <version>\n也可使用 pnpm version:check [tag] 或 pnpm version:set <version>。";
  const [mode, value] = args;
  const help = (argument) => ["--help", "-h"].includes(argument);
  if (
    (args.length === 1 && help(mode)) ||
    (args.length === 2 && ["check", "set"].includes(mode) && help(value))
  ) {
    console.log(usage);
    return;
  }
  if (
    !["check", "set"].includes(mode) ||
    (mode === "check" && args.length > 2) ||
    (mode === "set" && args.length !== 2) ||
    (value !== undefined && (!value || value.startsWith("-")))
  )
    throw new Error(usage);

  const root = resolve(import.meta.dirname, "..");
  if (mode === "check") {
    const tag =
      value ?? process.env.GITHUB_REF?.match(/^refs\/tags\/(.+)$/)?.[1];
    const version = checkVersions(root, tag);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${version}\nprerelease=${version.split("+")[0].includes("-")}\n`,
      );
    }
    console.log(`项目版本一致：${version}${tag ? `（${tag}）` : ""}`);
    return;
  }

  const updates = prepareVersionUpdates(root, value);
  // check 和模块导入不依赖已安装的前端工具；只有写版本时加载格式化器。
  const { format, resolveConfig } = await import("prettier");
  for (const update of updates) {
    if (!update.path.endsWith(".json")) continue;
    const filepath = join(root, update.path);
    update.content = await format(update.content, {
      ...(await resolveConfig(filepath)),
      filepath,
    });
  }
  applyFileChanges({ root, changes: updates });
  console.log(`版本号已更新: ${updates[0].previous} -> ${value}`);
  for (const { path } of updates) console.log(`  ${path}`);
  console.log(
    `\n下一步：提交后打 tag（git tag -a v${value} -m "v${value}"）并推送。`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

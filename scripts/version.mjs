import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyFileChanges, projectFile } from "./fs-utils.mjs";

// SemVer 2.0 的数字标识不能有前导零，构建元数据不受此限制。
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function validateVersion(version, config) {
  const match = typeof version === "string" && version.match(SEMVER);
  if (!match) throw new Error(`Invalid SemVer version: ${version}`);
  const core = match.slice(1, 4).map(BigInt);
  if (core.some((part) => part > 18446744073709551615n)) {
    throw new Error("Version exceeds the integer range supported by Cargo");
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
    throw new Error("NSIS version components must not exceed 65535");
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
          "bundle.windows.wix.version must be a valid MSI version: major.minor.patch[.build] (255.255.65535[.65535])",
        );
      }
      return;
    }
    if (core[0] > 255n || core[1] > 255n || core[2] > 65535n) {
      throw new Error(
        "MSI version must satisfy major <= 255, minor <= 255, patch <= 65535",
      );
    }
    // Tauri 优先使用构建元数据，再使用预发布标识作为 MSI 可选的第四段。
    // 文本预发布标识需要显式配置 wix.version。
    const fourth = match[5] ?? match[4];
    if (fourth && (!/^\d+$/.test(fourth) || BigInt(fourth) > 65535n)) {
      throw new Error(
        "MSI prerelease identifiers or build metadata must be integers <= 65535; for text prereleases, configure bundle.windows.wix.version or build NSIS only",
      );
    }
  }
}

function tomlValue(content, key, label) {
  const match = content.match(
    new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\r\\n]+)"\\s*(?:#.*)?$`, "m"),
  );
  if (!match) throw new Error(`${key} was not found in ${label}`);
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
  if (!packageSection) throw new Error("[package] was not found in Cargo.toml");
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
    throw new Error(
      `Cargo.lock must contain exactly one local package named ${packageName}`,
    );
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

export function checkVersionValues(config, files, tag) {
  const version = files[0].version;
  validateVersion(version, config);
  for (const file of files) {
    if (file.version !== version) {
      throw new Error(
        `${file.path} version ${file.version} does not match package.json version ${version}`,
      );
    }
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`tag ${tag} does not match project version v${version}`);
  }
  return version;
}

export function checkVersions(root, tag) {
  const { config, files } = readVersionFiles(root);
  return checkVersionValues(config, files, tag);
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
    "Usage: node scripts/version.mjs check [tag] | set <version>\nYou can also use pnpm version:check [tag] or pnpm version:set <version>.";
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
    console.log(`Project versions match: ${version}${tag ? ` (${tag})` : ""}`);
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
  console.log(`Version updated: ${updates[0].previous} -> ${value}`);
  for (const { path } of updates) console.log(`  ${path}`);
  console.log(
    `\nNext: commit the changes, create a tag (git tag -a v${value} -m "v${value}"), and push.`,
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

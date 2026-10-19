import { readFileSync } from "node:fs";
import { join } from "node:path";

// SemVer 2.0: numeric identifiers cannot have leading zeroes; build metadata can.
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
  if (includes("msi") && !bundle?.windows?.wix?.version) {
    if (core[0] > 255n || core[1] > 255n || core[2] > 65535n) {
      throw new Error(
        "MSI 版本号必须满足 major <= 255、minor <= 255、patch <= 65535",
      );
    }
    // Tauri uses build metadata first, then the prerelease identifier, as MSI's
    // optional fourth component. Textual prereleases need an explicit wix.version.
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
  const read = (path) => readFileSync(join(root, path), "utf8");
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
  let lock;
  try {
    lock = read(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (lock !== undefined) {
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
  }
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
  // Parse every file and validate the Windows bundle version before writing any.
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
    return { path: file.path, content, previous: file.version };
  });
}

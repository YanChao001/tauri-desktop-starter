#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  buildEnvironment,
  effectiveConfig,
  parseBuildArgs,
} from "./build-lib.mjs";
import { checkVersions } from "./version.mjs";

const TARGETS = {
  "x86_64-pc-windows-msvc": { platform: "windows-x86_64", config: "windows" },
  "aarch64-apple-darwin": { platform: "darwin-aarch64", config: "macos" },
  "x86_64-apple-darwin": { platform: "darwin-x86_64", config: "macos" },
  "x86_64-unknown-linux-gnu": { platform: "linux-x86_64", config: "linux" },
};
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

function repositoryName(value) {
  if (typeof value !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value))
    throw new Error("GITHUB_REPOSITORY 必须是 owner/repository");
  return value;
}

export function updaterReleasePlan({
  brand,
  privateKey,
  repository,
  signPath,
}) {
  const publicKey = brand.updates?.publicKey?.trim() ?? "";
  const hasPrivate = typeof privateKey === "string" && !!privateKey.trim();
  if (!publicKey && !hasPrivate) return { enabled: false };
  if (!publicKey || !hasPrivate)
    throw new Error(
      "自动更新发布需要同时配置 app.config.json 的 updates.publicKey 与 TAURI_SIGNING_PRIVATE_KEY secret",
    );
  if (signPath)
    throw new Error(
      "SignPath 后签会改变安装包字节；当前 updater 发布只支持 Tauri 打包前的代码签名，请勿同时启用 SignPath",
    );
  const endpoint = `https://github.com/${repositoryName(repository)}/releases/latest/download/latest.json`;
  if (brand.updates.endpoint !== endpoint)
    throw new Error(`updates.endpoint 必须与当前 GitHub 仓库一致：${endpoint}`);
  return {
    enabled: true,
    overlay: {
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: publicKey,
          endpoints: [endpoint],
          requireSignedVersion: true,
        },
      },
    },
  };
}

// 与 tauri-action@v1 默认 ghAssetName 一致，包含 .app 归档的特殊命名。
export function releaseAssetName(path, { productName, version, target }) {
  let name = basename(path.replaceAll("\\", "/"));
  if (name.endsWith(".app.tar.gz") || name.endsWith(".app.tar.gz.sig")) {
    const arch = target === "aarch64-apple-darwin" ? "aarch64" : "x64";
    name = `${productName}_${version}_${arch}.app.tar.gz${name.endsWith(".sig") ? ".sig" : ""}`;
  }
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, ".")
    .replace(/\.\./g, ".");
}

function artifactKind(path, platform) {
  const normalized = path.replaceAll("\\", "/");
  if (platform.startsWith("windows-")) {
    if (/\/bundle\/nsis\/[^/]+\.exe$/.test(normalized)) return "nsis";
    if (/\/bundle\/msi\/[^/]+\.msi$/.test(normalized)) return "msi";
  } else if (platform.startsWith("darwin-")) {
    if (/\/bundle\/macos\/[^/]+\.app\.tar\.gz$/.test(normalized)) return "app";
  } else {
    if (/\/bundle\/appimage\/[^/]+\.AppImage$/.test(normalized))
      return "appimage";
    if (/\/bundle\/deb\/[^/]+\.deb$/.test(normalized)) return "deb";
    if (/\/bundle\/rpm\/[^/]+\.rpm$/.test(normalized)) return "rpm";
  }
  return undefined;
}

/** 只处理本次 tauri-action 明确返回的产物。 */
export function collectUpdaterMetadata({
  paths,
  target,
  repository,
  version,
  productName,
}) {
  const info = TARGETS[target];
  if (!info) throw new Error(`自动更新发布不支持目标：${target}`);
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string"))
    throw new Error("tauri-action 未返回有效的 artifactPaths");
  repositoryName(repository);
  const tag = `v${version}`;
  const files = new Set(paths.map((path) => resolve(path)));
  const platforms = {};
  const verification = [];
  const assets = new Set();
  for (const path of files) {
    const kind = artifactKind(path, info.platform);
    if (!kind) continue;
    const signature = `${path}.sig`;
    if (!files.has(signature))
      throw new Error(`本次产物缺少更新签名：${basename(signature)}`);
    if (!statSync(path).isFile() || statSync(path).size === 0)
      throw new Error(`更新产物必须是非空文件：${basename(path)}`);
    const size = statSync(signature).size;
    if (size === 0 || size > 16 * 1024) throw new Error("更新签名文件大小无效");
    const key = `${info.platform}-${kind}`;
    if (Object.hasOwn(platforms, key))
      throw new Error(`同一更新平台存在多个安装包：${key}`);
    const asset = releaseAssetName(path, { productName, version, target });
    if (assets.has(asset)) throw new Error(`更新产物上传名称冲突：${asset}`);
    assets.add(asset);
    platforms[key] = {
      signature: readFileSync(signature, "utf8").trim(),
      url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`,
    };
    verification.push({ path, signature });
  }
  for (const path of files) {
    if (
      path.endsWith(".sig") &&
      artifactKind(path.slice(0, -4), info.platform) &&
      !files.has(path.slice(0, -4))
    )
      throw new Error(`本次签名缺少对应更新包：${basename(path)}`);
  }
  if (!verification.length)
    throw new Error(`没有找到 ${info.platform} 的 v2 更新包与签名`);
  const preferred = info.platform.startsWith("windows-")
    ? (platforms[`${info.platform}-nsis`] ?? platforms[`${info.platform}-msi`])
    : info.platform.startsWith("darwin-")
      ? platforms[`${info.platform}-app`]
      : platforms[`${info.platform}-appimage`];
  // Linux 通用入口只接受 AppImage；DEB / RPM 必须使用对应安装类型的键。
  if (preferred) platforms[info.platform] = preferred;
  return {
    metadata: { version, tag, repository, target, platforms },
    verification,
  };
}

export function mergeUpdaterMetadata(
  records,
  { version, repository, now = new Date() },
) {
  repositoryName(repository);
  if (!Array.isArray(records) || records.length !== Object.keys(TARGETS).length)
    throw new Error("latest.json 必须汇总本次全部四个编译目标");
  const seen = new Set();
  const platforms = {};
  for (const record of records) {
    const info = TARGETS[record.target];
    if (
      !info ||
      seen.has(record.target) ||
      record.version !== version ||
      record.tag !== `v${version}` ||
      record.repository !== repository
    )
      throw new Error("更新元数据目标重复，或仓库、tag、版本与本次发布不一致");
    seen.add(record.target);
    const keys = Object.keys(record.platforms ?? {});
    if (
      !keys.includes(info.platform) &&
      !(
        info.platform.startsWith("linux-") &&
        keys.some((key) =>
          ["deb", "rpm"].some((kind) => key === `${info.platform}-${kind}`),
        )
      )
    )
      throw new Error(`缺少默认更新平台：${info.platform}`);
    for (const [key, value] of Object.entries(record.platforms)) {
      const allowed = info.platform.startsWith("windows-")
        ? [info.platform, `${info.platform}-nsis`, `${info.platform}-msi`]
        : info.platform.startsWith("darwin-")
          ? [info.platform, `${info.platform}-app`]
          : [
              info.platform,
              `${info.platform}-appimage`,
              `${info.platform}-deb`,
              `${info.platform}-rpm`,
            ];
      if (
        !allowed.includes(key) ||
        Object.hasOwn(platforms, key) ||
        !value?.signature ||
        typeof value.url !== "string"
      )
        throw new Error(`无效或重复的更新平台：${key}`);
      const expected = `https://github.com/${repository}/releases/download/${encodeURIComponent(`v${version}`)}/`;
      if (
        !value.url.startsWith(expected) ||
        !value.url.slice(expected.length) ||
        value.url.slice(expected.length).includes("/")
      )
        throw new Error("更新产物 URL 必须指向本次仓库与 tag 的 Release 资产");
      platforms[key] = value;
    }
  }
  return {
    version,
    notes: `Release v${version}`,
    pub_date: now.toISOString(),
    platforms: Object.fromEntries(
      Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

function command(binary, args, root, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: root,
    env: buildEnvironment(),
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${binary} 执行失败（${result.status ?? result.signal}）`);
  return result.stdout;
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function main() {
  const root = resolve(import.meta.dirname, "..");
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !["prepare", "collect", "merge"].includes(mode)
  )
    throw new Error(
      "用法: node scripts/release-lib.mjs <prepare|collect|merge>",
    );
  const version = checkVersions(
    root,
    process.env.GITHUB_REF?.match(/^refs\/tags\/(.+)$/)?.[1],
  );
  const brand = json(join(root, "app.config.json"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (mode === "prepare") {
    const plan = updaterReleasePlan({
      brand,
      privateKey: process.env.TAURI_SIGNING_PRIVATE_KEY,
      repository,
      signPath: process.env.SIGNPATH_ORGANIZATION_ID,
    });
    output("enabled", String(plan.enabled));
    if (plan.enabled) {
      const configPath = "src-tauri/.tauri-updater-ci.json";
      writeFileSync(
        join(root, configPath),
        `${JSON.stringify(plan.overlay, null, 2)}\n`,
      );
      output("args", `--config ${configPath}`);
    }
    console.log(
      plan.enabled
        ? "已启用 v2 更新包与版本绑定签名"
        : "未配置更新签名密钥，发布普通安装包",
    );
    return;
  }
  const destination = join(root, "artifacts", version, "updater-metadata");
  if (mode === "collect") {
    const target = process.env.ARTIFACT_TARGET;
    const info = TARGETS[target];
    if (!info) throw new Error("ARTIFACT_TARGET 不受支持");
    const config = effectiveConfig(
      root,
      parseBuildArgs([]),
      version,
      info.config,
    );
    const { metadata, verification } = collectUpdaterMetadata({
      paths: JSON.parse(process.env.TAURI_ARTIFACT_PATHS ?? "null"),
      target,
      version,
      repository,
      productName: config.productName,
    });
    const temporary = mkdtempSync(
      join(tmpdir(), "starter-update-verification-"),
    );
    try {
      const input = join(temporary, "input.json");
      writeFileSync(
        input,
        JSON.stringify({
          publicKey: brand.updates.publicKey,
          version,
          files: verification,
        }),
      );
      command(
        "cargo",
        [
          "run",
          "--manifest-path",
          "src-tauri/Cargo.toml",
          "--locked",
          "--features",
          "bindings",
          "--bin",
          "verify-updater",
          "--",
          input,
        ],
        root,
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    mkdirSync(destination, { recursive: true });
    const file = join(destination, `${target}.json`);
    writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
    output("metadata-file", file);
    console.log(`已验证并记录 ${target} 更新元数据`);
    return;
  }
  const source = resolve(
    process.env.UPDATER_METADATA_DIR ?? "updater-metadata",
  );
  if (!existsSync(source))
    throw new Error("缺少本次 workflow 的更新元数据目录");
  const files = readdirSync(source, { recursive: true }).filter((path) =>
    path.endsWith(".json"),
  );
  const manifest = mergeUpdaterMetadata(
    files.map((file) => json(join(source, file))),
    { version, repository },
  );
  const assets = JSON.parse(
    command(
      "gh",
      [
        "release",
        "view",
        `v${version}`,
        "--repo",
        repository,
        "--json",
        "assets,isDraft,tagName",
      ],
      root,
      { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
    ),
  );
  if (!assets.isDraft || assets.tagName !== `v${version}`)
    throw new Error("更新元数据只能上传到本次版本的 draft Release");
  const available = new Set(assets.assets.map((asset) => asset.url));
  for (const value of Object.values(manifest.platforms)) {
    if (!available.has(value.url) || !available.has(`${value.url}.sig`))
      throw new Error(`Release 缺少更新包或签名资产：${value.url}`);
  }
  mkdirSync(destination, { recursive: true });
  const file = join(destination, "latest.json");
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  command(
    "gh",
    [
      "release",
      "upload",
      `v${version}`,
      file,
      "--repo",
      repository,
      "--clobber",
    ],
    root,
  );
  output("manifest-file", file);
  console.log("已一次性汇总全部平台并上传 latest.json 到 draft Release");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

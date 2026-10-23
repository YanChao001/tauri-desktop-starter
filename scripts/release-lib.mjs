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
import { generateReleaseNotes, updaterReleaseNotes } from "./release-notes.mjs";

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

function assertDraftRelease(release, version) {
  if (!release.draft || release.tag_name !== `v${version}`)
    throw new Error("资产只能上传到本次版本的 draft Release");
}

/** 由单一 job 创建或复用草稿，再把 ID 传给所有并行构建。 */
export function ensureDraftRelease({ version, repository, commit }, request) {
  const endpoint = `repos/${repositoryName(repository)}/releases`;
  const allReleases = request([
    `${endpoint}?per_page=100`,
    "--paginate",
    "--slurp",
  ]).flat();
  const releases = allReleases.filter(
    (release) => release.tag_name === `v${version}`,
  );
  if (releases.length > 1)
    throw new Error(`v${version} 存在多个 Release，请先归并草稿资产再重跑`);
  if (releases.length === 1) {
    const release = releases[0];
    assertDraftRelease(release, version);
    if (release.target_commitish !== commit)
      throw new Error("草稿的源码提交与本次发布不一致，请使用新版本和新 tag");
    return release.id;
  }
  const release = request([endpoint, "--method", "POST"], {
    tag_name: `v${version}`,
    target_commitish: commit,
    name: `v${version}`,
    body: generateReleaseNotes(
      { version, repository, commit, releases: allReleases },
      request,
    ),
    draft: true,
    prerelease: version.split("+")[0].includes("-"),
  });
  return release.id;
}

function readDraftRelease({ repository, version, releaseId }, request) {
  if (!/^[1-9]\d*$/.test(releaseId ?? ""))
    throw new Error("RELEASE_ID 必须来自本次准备草稿的 job");
  const release = request([`repos/${repository}/releases/${releaseId}`]);
  assertDraftRelease(release, version);
  return release;
}

export function uploadReleaseAsset(file, release, repository, request) {
  const name = basename(file);
  const existing = release.assets.find((asset) => asset.name === name);
  if (existing)
    request([
      `repos/${repository}/releases/assets/${existing.id}`,
      "--method",
      "DELETE",
    ]);
  return request([
    `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    "--method",
    "POST",
    "--header",
    "Content-Type: application/octet-stream",
    "--input",
    file,
  ]);
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

// tauri-action@v1 请求上传的名称；最终名称由 GitHub 返回，不能预猜其空格替换规则。
export function releaseAssetName(path, { productName, version, target }) {
  let name = basename(path.replaceAll("\\", "/"));
  if (name.endsWith(".app.tar.gz") || name.endsWith(".app.tar.gz.sig")) {
    const arch = target === "aarch64-apple-darwin" ? "aarch64" : "x64";
    name = `${productName}_${version}_${arch}.app.tar.gz${name.endsWith(".sig") ? ".sig" : ""}`;
  }
  return name.trim();
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
  { version, repository, now = new Date(), notes },
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
    notes: updaterReleaseNotes(notes, { version, repository }),
    pub_date: now.toISOString(),
    platforms: Object.fromEntries(
      Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/** 草稿可能使用临时下载 URL；以已上传资产的真实名称生成正式 tag 的 URL。 */
export function resolveReleaseAssets(
  manifest,
  release,
  { version, repository },
) {
  repositoryName(repository);
  assertDraftRelease(release, version);
  const prefix = `https://github.com/${repository}/releases/download/${encodeURIComponent(`v${version}`)}/`;
  const find = (requested) => {
    const matches = release.assets.filter(
      (asset) => asset.name === requested || asset.label === requested,
    );
    if (matches.length !== 1)
      throw new Error(`Release 缺少或存在重名的更新包或签名资产：${requested}`);
    const asset = matches[0];
    if (
      asset.state !== "uploaded" ||
      !(asset.size > 0) ||
      typeof asset.name !== "string" ||
      !asset.name ||
      /[/\\]/.test(asset.name) ||
      [...asset.name].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }) ||
      asset.name === "." ||
      asset.name === ".."
    )
      throw new Error(`Release 资产尚未就绪或名称无效：${requested}`);
    return asset;
  };
  return {
    ...manifest,
    platforms: Object.fromEntries(
      Object.entries(manifest.platforms).map(([platform, value]) => {
        if (!value.url.startsWith(prefix))
          throw new Error(
            "更新产物 URL 必须指向本次仓库与 tag 的 Release 资产",
          );
        const requested = decodeURIComponent(value.url.slice(prefix.length));
        const asset = find(requested);
        find(`${requested}.sig`);
        return [
          platform,
          { ...value, url: `${prefix}${encodeURIComponent(asset.name)}` },
        ];
      }),
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
    !["draft", "notes", "prepare", "collect", "merge", "upload"].includes(mode)
  )
    throw new Error(
      "用法: node scripts/release-lib.mjs <draft|notes|prepare|collect|merge|upload>",
    );
  const version = checkVersions(
    root,
    process.env.GITHUB_REF?.match(/^refs\/tags\/(.+)$/)?.[1],
  );
  const brand = json(join(root, "app.config.json"));
  const repository = repositoryName(process.env.GITHUB_REPOSITORY);
  const request = (args, body) => {
    const result = command(
      "gh",
      ["api", ...args, ...(body === undefined ? [] : ["--input", "-"])],
      root,
      {
        stdio: ["pipe", "pipe", "inherit"],
        encoding: "utf8",
        input: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return result.trim() ? JSON.parse(result) : undefined;
  };
  if (mode === "draft" || mode === "notes") {
    const commit = command("git", ["rev-parse", "HEAD"], root, {
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
    }).trim();
    if (mode === "notes") {
      const releases = request([
        `repos/${repository}/releases?per_page=100`,
        "--paginate",
        "--slurp",
      ]).flat();
      const notes = generateReleaseNotes(
        { version, repository, commit, releases },
        request,
      );
      const directory = join(root, "artifacts", version);
      mkdirSync(directory, { recursive: true });
      const file = join(directory, "release-notes.md");
      writeFileSync(file, `${notes}\n`);
      console.log(`已生成发布说明预览：${file}（未修改 GitHub Release）`);
      return;
    }
    const releaseId = ensureDraftRelease(
      { version, repository, commit },
      request,
    );
    output("release-id", releaseId);
    console.log(`全部平台将上传到 draft Release ${releaseId}`);
    return;
  }
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
  const release = readDraftRelease(
    { repository, version, releaseId: process.env.RELEASE_ID },
    request,
  );
  if (mode === "upload") {
    const directory = process.env.RELEASE_ASSET_DIR;
    if (!directory) throw new Error("缺少 RELEASE_ASSET_DIR");
    for (const name of readdirSync(directory))
      uploadReleaseAsset(join(directory, name), release, repository, request);
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
  const manifest = resolveReleaseAssets(
    mergeUpdaterMetadata(
      files.map((file) => json(join(source, file))),
      {
        version,
        repository,
        notes: release.body,
      },
    ),
    release,
    { version, repository },
  );
  mkdirSync(destination, { recursive: true });
  const file = join(destination, "latest.json");
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  uploadReleaseAsset(file, release, repository, request);
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

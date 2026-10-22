import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { parse as parseToml } from "smol-toml";
import { checkVersions } from "./version.mjs";
import { applyFileChanges, projectFile } from "./fs-utils.mjs";

const FIELDS = new Set([
  "schemaVersion",
  "name",
  "shortName",
  "packageName",
  "identifier",
  "description",
  "author",
  "repositoryUrl",
  "docsUrl",
  "homepageUrl",
  "browserStorageNamespace",
  "integration",
  "defaultMode",
  "updates",
]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function https(value, label, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    Buffer.byteLength(value) > 4096
  )
    throw new Error(`${label} 必须是最多 4096 UTF-8 字节的 URL 文本`);
  if (allowEmpty && value === "") return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 必须是 HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(`${label} 必须是无凭据的 HTTPS URL`);
}

/** 品牌字段限制在数据值中；不接受路径、脚本或签名私钥。 */
export function validateAppConfig(config) {
  if (!object(config) || config.schemaVersion !== 1)
    throw new Error("app.config.json schemaVersion 必须为 1");
  for (const key of Object.keys(config))
    if (!FIELDS.has(key)) throw new Error(`未知品牌字段：${key}`);
  for (const key of ["name", "shortName", "description", "author"])
    if (
      typeof config[key] !== "string" ||
      !config[key].trim() ||
      config[key] !== config[key].trim() ||
      [...config[key]].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      config[key].length > 200
    )
      throw new Error(`${key} 必须是 1–200 字的单行非空文本`);
  if (
    /[<>:"/\\|?*]/.test(config.name) ||
    /\.$/.test(config.name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(config.name)
  )
    throw new Error("name 不能包含 Windows 文件名保留字符或设备名称");
  if (
    typeof config.packageName !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(config.packageName) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(config.packageName) ||
    config.packageName.length > 64
  )
    throw new Error(
      "packageName 必须是小写 kebab-case（最多 64 字符），不能使用 Windows 设备名称",
    );
  if (
    typeof config.identifier !== "string" ||
    !/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*){2,}$/.test(
      config.identifier,
    ) ||
    config.identifier.length > 200
  )
    throw new Error("identifier 必须是至少三段的反向域名标识符");
  if (!["demo", "minimal"].includes(config.defaultMode))
    throw new Error("defaultMode 必须是 demo 或 minimal");
  https(config.repositoryUrl, "repositoryUrl");
  https(config.docsUrl, "docsUrl");
  https(config.homepageUrl, "homepageUrl");
  if (
    typeof config.browserStorageNamespace !== "string" ||
    !/^[A-Za-z][A-Za-z0-9.-]{0,199}$/.test(config.browserStorageNamespace)
  )
    throw new Error(
      "browserStorageNamespace 必须是 1–200 位字母、数字、点或连字符，且以字母开头",
    );
  if (
    !object(config.integration) ||
    Object.keys(config.integration).some(
      (key) => !["deepLinkScheme", "fileExtension"].includes(key),
    )
  )
    throw new Error("integration 仅允许 deepLinkScheme 与 fileExtension");
  for (const key of ["deepLinkScheme", "fileExtension"])
    if (
      typeof config.integration[key] !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(config.integration[key])
    )
      throw new Error(
        `integration.${key} 必须是 1–64 位小写字母、数字或连字符，且以字母开头`,
      );
  if (
    [
      "http",
      "https",
      "ws",
      "wss",
      "about",
      "blob",
      "file",
      "ftp",
      "mailto",
      "tel",
      "data",
      "javascript",
      "tauri",
      "asset",
      "ipc",
    ].includes(config.integration.deepLinkScheme)
  )
    throw new Error("integration.deepLinkScheme 不能占用系统或 WebView 协议");
  if (
    [
      "exe",
      "com",
      "bat",
      "cmd",
      "msi",
      "ps1",
      "lnk",
      "url",
      "txt",
      "json",
      "md",
      "markdown",
      "log",
      "csv",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "pdf",
      "html",
      "tsv",
      "rs",
      "ts",
      "js",
      "css",
      "toml",
      "yaml",
      "yml",
    ].includes(config.integration.fileExtension)
  )
    throw new Error("integration.fileExtension 必须使用应用专用扩展名");
  if (
    !object(config.updates) ||
    Object.keys(config.updates).some(
      (key) => !["endpoint", "publicKey"].includes(key),
    )
  )
    throw new Error("updates 仅允许 endpoint 与 publicKey");
  https(config.updates.endpoint, "updates.endpoint", true);
  if (config.updates.endpoint.includes("#"))
    throw new Error("updates.endpoint 不能包含 URL fragment");
  if (
    typeof config.updates.publicKey !== "string" ||
    Buffer.byteLength(config.updates.publicKey) > 8192
  )
    throw new Error("updates.publicKey 必须是公钥文本，不能是私钥");
  if (config.updates.publicKey !== "") {
    try {
      // Tauri 使用标准 Base64 封装两行 minisign 公钥。
      // Buffer 解码允许非标准输入，需通过重新编码校验规范形式。
      const envelope = Buffer.from(config.updates.publicKey, "base64");
      if (envelope.toString("base64") !== config.updates.publicKey)
        throw new Error("Invalid Base64");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(envelope);
      const lines = text.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      if (
        lines.length !== 2 ||
        !/^untrusted comment: minisign public key:? [0-9A-Fa-f]{16}$/.test(
          lines[0],
        )
      )
        throw new Error("Invalid public key envelope");
      const packet = Buffer.from(lines[1], "base64");
      // minisign-verify 接受 Ed / ED 标识、8 字节密钥 ID 和 32 字节公钥。
      if (
        packet.toString("base64") !== lines[1] ||
        packet.length !== 42 ||
        packet[0] !== 0x45 ||
        ![0x64, 0x44].includes(packet[1])
      )
        throw new Error("Invalid public key packet");
    } catch {
      throw new Error(
        "updates.publicKey 必须是 Tauri 生成的 Base64 minisign 公钥，不能是私钥或无效文本",
      );
    }
  }
  return config;
}

function section(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...content.matchAll(
      new RegExp(
        `^\\[${escaped}\\][^\\S\\r\\n]*(?:#.*)?\\r?\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
        "gm",
      ),
    ),
  ];
  if (matches.length !== 1)
    throw new Error(`Cargo.toml 必须恰有一个 [${name}]`);
  return matches[0][0];
}

function field(content, key) {
  const matches = [
    ...content.matchAll(
      new RegExp(
        `^\\s*${key}\\s*=\\s*("(?:[^"\\\\\\r\\n]|\\\\.)*")[^\\r\\n]*$`,
        "gm",
      ),
    ),
  ];
  if (matches.length !== 1) throw new Error(`必须恰有一个 ${key} 文本字段`);
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    throw new Error(`${key} 必须使用支持的 TOML basic string`);
  }
}

function replaceField(content, key, value) {
  field(content, key);
  return content.replace(
    new RegExp(`^(\\s*${key}\\s*=\\s*)"(?:[^"\\\\\\r\\n]|\\\\.)*"`, "m"),
    (_, prefix) => prefix + JSON.stringify(value),
  );
}

const require = createRequire(import.meta.url);
function json(value, path = "app.config.json") {
  // 使用项目已锁定的格式器预检整份 JSON，初始化后仍满足 format:check。
  return execFileSync(
    process.execPath,
    [
      join(dirname(require.resolve("prettier")), "bin", "prettier.cjs"),
      "--stdin-filepath",
      path,
    ],
    {
      input: JSON.stringify(value, null, 2),
      encoding: "utf8",
      cwd: join(import.meta.dirname, ".."),
      windowsHide: true,
    },
  );
}
function html(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 先解析、校验所有目标，再生成有限位置的变更；不会全局替换源码。 */
export function prepareInitialization(
  root,
  patch = {},
  { minimal = false } = {},
) {
  root = realpathSync(root);
  if (!object(patch)) throw new Error("--config 必须是 JSON 对象");
  for (const key of Object.keys(patch))
    if (!FIELDS.has(key)) throw new Error(`未知品牌字段：${key}`);
  checkVersions(root);
  const originals = new Map();
  const read = (path) => {
    const content = readFileSync(projectFile(root, path), "utf8");
    originals.set(path, content);
    return content;
  };
  const current = validateAppConfig(JSON.parse(read("app.config.json")));
  if (patch.updates !== undefined && !object(patch.updates))
    throw new Error("updates 必须是对象");
  if (patch.integration !== undefined && !object(patch.integration))
    throw new Error("integration 必须是对象");
  const identityChanged =
    patch.identifier !== undefined && patch.identifier !== current.identifier;
  const repositoryChanged =
    patch.repositoryUrl !== undefined &&
    patch.repositoryUrl !== current.repositoryUrl;
  const endpointChanged =
    patch.updates?.endpoint !== undefined &&
    patch.updates.endpoint !== current.updates.endpoint;
  const derivedName =
    patch.packageName && patch.packageName !== current.packageName
      ? patch.packageName
      : (patch.identifier ?? current.identifier)
          .toLowerCase()
          .replaceAll(".", "-");
  const next = validateAppConfig({
    ...current,
    ...(repositoryChanged
      ? { docsUrl: patch.repositoryUrl, homepageUrl: patch.repositoryUrl }
      : {}),
    ...(identityChanged ? { browserStorageNamespace: patch.identifier } : {}),
    ...patch,
    integration: {
      ...current.integration,
      ...(identityChanged
        ? { deepLinkScheme: derivedName, fileExtension: derivedName }
        : {}),
      ...patch.integration,
    },
    updates: {
      ...current.updates,
      ...(identityChanged || repositoryChanged
        ? { endpoint: "", publicKey: "" }
        : {}),
      ...(endpointChanged ? { publicKey: "" } : {}),
      ...patch.updates,
    },
    ...(minimal ? { defaultMode: "minimal" } : {}),
  });
  const outputs = new Map([["app.config.json", json(next)]]);
  const pkg = JSON.parse(read("package.json"));
  pkg.name = next.packageName;
  pkg.description = next.description;
  pkg.author = next.author;
  pkg.repository = { type: "git", url: next.repositoryUrl };
  pkg.homepage = next.homepageUrl;
  outputs.set("package.json", json(pkg, "package.json"));
  const manifest = read("src-tauri/Cargo.toml");
  parseToml(manifest);
  const packageSection = section(manifest, "package");
  const libSection = section(manifest, "lib");
  const oldPackage = field(packageSection, "name");
  const oldLib = field(libSection, "name");
  const nextLib = `${next.packageName.replaceAll("-", "_")}_lib`;
  let packageOutput = replaceField(packageSection, "name", next.packageName);
  if (
    /^\s*default-run\s*=/m.test(packageOutput) &&
    field(packageOutput, "default-run") === oldPackage
  )
    packageOutput = replaceField(
      packageOutput,
      "default-run",
      next.packageName,
    );
  packageOutput = replaceField(packageOutput, "description", next.description);
  if (!/^\s*authors\s*=\s*\[[^\r\n]*\]/m.test(packageOutput))
    throw new Error("Cargo package.authors 必须是单行数组");
  packageOutput = packageOutput.replace(
    /^(\s*authors\s*=\s*)\[[^\r\n]*\]/m,
    (_, prefix) => `${prefix}[${JSON.stringify(next.author)}]`,
  );
  outputs.set(
    "src-tauri/Cargo.toml",
    manifest
      .replace(packageSection, packageOutput)
      .replace(libSection, replaceField(libSection, "name", nextLib)),
  );
  const lock = read("src-tauri/Cargo.lock");
  parseToml(lock);
  const own = [
    ...lock.matchAll(
      /^\[\[package\]\][^\S\r\n]*\r?\n[\s\S]*?(?=^\[\[|(?![\s\S]))/gm,
    ),
  ].filter(
    (match) =>
      field(match[0], "name") === oldPackage &&
      !/^\s*source\s*=/m.test(match[0]),
  );
  if (own.length !== 1) throw new Error("Cargo.lock 必须恰有一个本地应用包");
  outputs.set(
    "src-tauri/Cargo.lock",
    lock.replace(own[0][0], replaceField(own[0][0], "name", next.packageName)),
  );
  const main = read("src-tauri/src/main.rs");
  const entry = new RegExp(`\\b${oldLib}::run\\(\\)`, "g");
  if ([...main.matchAll(entry)].length !== 1)
    throw new Error("main.rs 必须恰有一个当前库的 run() 入口");
  outputs.set(
    "src-tauri/src/main.rs",
    main.replace(entry, `${nextLib}::run()`),
  );
  for (const [binPath, call] of [
    ["src-tauri/src/bin/export-bindings.rs", "bindings::export"],
    [
      "src-tauri/src/bin/verify-updater.rs",
      "update_signature::verify_manifest",
    ],
  ]) {
    if (!existsSync(join(root, binPath))) continue;
    const exporter = read(binPath);
    const reference = new RegExp(`\\b${oldLib}::${call}\\(`, "g");
    if ([...exporter.matchAll(reference)].length !== 1)
      throw new Error(`${binPath} 必须恰有一个当前库的 ${call}() 入口`);
    outputs.set(binPath, exporter.replace(reference, `${nextLib}::${call}(`));
  }
  for (const file of readdirSync(join(root, "src-tauri")).filter((name) =>
    /^tauri(?:\.[a-z0-9-]+)?\.conf\.json$/.test(name),
  )) {
    const path = `src-tauri/${file}`;
    const config = JSON.parse(read(path));
    if (config.productName === current.name) config.productName = next.name;
    if (config.identifier === current.identifier)
      config.identifier = next.identifier;
    if (file === "tauri.conf.json") {
      config.productName = next.name;
      config.identifier = next.identifier;
      config.bundle ??= {};
      config.bundle.shortDescription = next.description;
      config.bundle.publisher = next.author;
      config.bundle.homepage = next.homepageUrl;
      if (current.author !== next.author || !config.bundle.copyright)
        config.bundle.copyright = `© ${new Date().getUTCFullYear()} ${next.author}`;
    } else if (file === "tauri.e2e.conf.json") {
      config.identifier = `${next.identifier}.e2e`;
      config.productName = `${next.shortName} E2E`;
    }
    if (file === "tauri.conf.json" || config.plugins?.["deep-link"]?.desktop) {
      config.plugins ??= {};
      config.plugins["deep-link"] ??= {};
      const desktop = config.plugins["deep-link"].desktop ?? {};
      if (
        !object(desktop) ||
        (desktop.schemes !== undefined && !Array.isArray(desktop.schemes))
      )
        throw new Error("deep-link.desktop 必须使用含 schemes 数组的对象配置");
      config.plugins["deep-link"].desktop = {
        ...desktop,
        schemes: [
          ...new Set([
            ...(desktop.schemes ?? []).map((scheme) =>
              scheme === current.integration.deepLinkScheme
                ? next.integration.deepLinkScheme
                : scheme,
            ),
            next.integration.deepLinkScheme,
          ]),
        ],
      };
    }
    if (file === "tauri.conf.json" || config.bundle?.fileAssociations) {
      config.bundle ??= {};
      const associations = config.bundle.fileAssociations ?? [];
      const previous = associations.find((entry) =>
        entry.ext?.includes(current.integration.fileExtension),
      );
      const association = {
        ...previous,
        ext: [
          ...new Set([
            ...(previous?.ext ?? []).map((extension) =>
              extension === current.integration.fileExtension
                ? next.integration.fileExtension
                : extension,
            ),
            next.integration.fileExtension,
          ]),
        ],
        name: `${next.name} Document`,
        description: `UTF-8 ${next.name} document`,
        role: "Editor",
        mimeType: `application/x-${next.integration.fileExtension}`,
      };
      config.bundle.fileAssociations = previous
        ? associations.map((entry) =>
            entry === previous ? association : entry,
          )
        : [...associations, association];
    }
    if (Array.isArray(config.app?.windows))
      for (const window of config.app.windows)
        if (window.label === "main") window.title = next.name;
    outputs.set(path, json(config));
  }
  const index = read("index.html");
  if ([...index.matchAll(/<title>[\s\S]*?<\/title>/g)].length !== 1)
    throw new Error("index.html 必须恰有一个 title");
  outputs.set(
    "index.html",
    index.replace(
      /<title>[\s\S]*?<\/title>/,
      `<title>${html(next.name)}</title>`,
    ),
  );
  for (const path of ["README.md", "README.en.md"]) {
    if (!existsSync(join(root, path))) continue;
    const content = read(path);
    // 只同步 README 标题和已知品牌链接，保留正文、相对链接及历史示例。
    const links = [
      [current.docsUrl, next.docsUrl],
      [current.homepageUrl, next.homepageUrl],
      [current.repositoryUrl, next.repositoryUrl],
    ].sort(([left], [right]) => right.length - left.length);
    const updated = content
      .replace(/^# [^\r\n]+/, `# ${next.name}`)
      .replace(/\]\((https:\/\/[^\s)]+)\)/g, (match, url) => {
        const replacement = links.find(
          ([before]) =>
            url === before ||
            (before === current.repositoryUrl && url.startsWith(`${before}/`)),
        );
        return replacement
          ? `](${replacement[1]}${url.slice(replacement[0].length)})`
          : match;
      });
    outputs.set(path, updated);
  }
  const signpath = ".signpath/artifact-configuration.xml";
  if (existsSync(join(root, signpath))) {
    const content = read(signpath);
    if ([...content.matchAll(/\bproduct-name="[^"]*"/g)].length !== 1)
      throw new Error("SignPath 配置必须恰有一个 product-name 限制");
    outputs.set(
      signpath,
      content.replace(
        /\bproduct-name="[^"]*"/,
        `product-name="${html(next.name)}"`,
      ),
    );
  }
  // 提交前再次解析完整目标文件，尤其是 TOML 引号/转义后的语法。
  for (const [path, content] of outputs) {
    if (path.endsWith(".json")) JSON.parse(content);
    if (path.endsWith(".toml") || path.endsWith(".lock")) parseToml(content);
  }
  const changes = [...outputs]
    .map(([path, content]) => ({ path, before: originals.get(path), content }))
    .filter((entry) => entry.before !== entry.content);
  return { root, config: next, changes };
}

export const applyInitialization = applyFileChanges;

export function initializationDiff(plan) {
  return plan.changes
    .map(({ path, before, content }) => {
      const oldLines = before.split("\n");
      const newLines = content.split("\n");
      let start = 0;
      while (
        start < Math.min(oldLines.length, newLines.length) &&
        oldLines[start] === newLines[start]
      )
        start++;
      let oldEnd = oldLines.length,
        newEnd = newLines.length;
      while (
        oldEnd > start &&
        newEnd > start &&
        oldLines[oldEnd - 1] === newLines[newEnd - 1]
      ) {
        oldEnd--;
        newEnd--;
      }
      return [
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -${start + 1},${oldEnd - start} +${start + 1},${newEnd - start} @@`,
        ...oldLines.slice(start, oldEnd).map((line) => `-${line}`),
        ...newLines.slice(start, newEnd).map((line) => `+${line}`),
      ].join("\n");
    })
    .join("\n");
}

#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { publishArtifacts } from "./artifact-lib.mjs";
import { checkVersions } from "./version.mjs";

const BUNDLES = new Set([
  "nsis",
  "msi",
  "deb",
  "rpm",
  "appimage",
  "dmg",
  "macos",
  "updater",
]);

/** 只接收 tauri-action 本次返回的明确文件列表，不扫描历史输出目录。 */
export function actionArtifactEntries(paths, { signedNsis = false } = {}) {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some((path) => typeof path !== "string" || !path)
  )
    throw new Error("tauri-action 未返回有效的产物文件列表");
  const entries = new Map();
  for (const original of paths) {
    const source = resolve(original);
    const parts = source.replaceAll("\\", "/").split("/");
    const index = parts.lastIndexOf("bundle");
    let path;
    if (signedNsis) {
      if (!source.endsWith("-setup.exe"))
        throw new Error("签名归档只接受 NSIS 安装包");
      path = `nsis/${basename(source)}`;
    } else {
      if (
        index < 0 ||
        !BUNDLES.has(parts[index + 1]) ||
        parts.length <= index + 2
      )
        throw new Error(`不是受支持的 Tauri 分发产物：${source}`);
      path = parts.slice(index + 1).join("/");
    }
    if (entries.has(path) && entries.get(path).source !== source)
      throw new Error(`产物文件名冲突：${path}`);
    entries.set(path, { source, path });
  }
  return [...entries.values()];
}

function main() {
  const signedNsis = process.argv.slice(2).includes("--signed-nsis");
  if (process.argv.slice(2).some((arg) => arg !== "--signed-nsis"))
    throw new Error("用法: node scripts/collect-artifacts.mjs [--signed-nsis]");
  const root = resolve(import.meta.dirname, "..");
  const version = checkVersions(root);
  const output = publishArtifacts(root, {
    version,
    target: process.env.ARTIFACT_TARGET,
    kind: "installers",
    entries: actionArtifactEntries(
      JSON.parse(process.env.TAURI_ARTIFACT_PATHS ?? "null"),
      { signedNsis },
    ),
  });
  const artifactPath = relative(root, output).replaceAll("\\", "/");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `artifact-dir=${artifactPath}\n`);
  console.log(`本次分发产物：${artifactPath}`);
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

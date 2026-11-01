#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryConfig } from "./repository-lib.mjs";
import { runRelease } from "./hosting/github-release.mjs";

// 旧工程入口保持稳定；平台协议集中在 hosting/ 下。
export {
  collectUpdaterMetadata,
  ensureDraftRelease,
  mergeUpdaterMetadata,
  releaseAssetName,
  resolveReleaseAssets,
  updaterReleasePlan,
  uploadReleaseAsset,
} from "./hosting/github-release.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (repositoryConfig.hosting.provider !== "github")
      throw new Error(
        `No release adapter for: ${repositoryConfig.hosting.provider}`,
      );
    runRelease();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryConfig } from "../repository-lib.mjs";
import { githubRequest } from "./github-api.mjs";
import {
  tagFromEnvironment,
  writeEnvironment,
  writeOutput,
} from "./github-env.mjs";

export function runAction(
  mode,
  {
    config = repositoryConfig,
    env = process.env,
    request = (args, body) => githubRequest(args, body, { config }),
    git = execFileSync,
  } = {},
) {
  if (config.hosting.provider !== "github")
    throw new Error(`No Actions adapter for: ${config.hosting.provider}`);
  if (mode === "verify-release-source") {
    git(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        "HEAD",
        `origin/${config.hosting.releaseBranch}`,
      ],
      { stdio: "inherit", windowsHide: true },
    );
    return;
  }
  if (mode === "signing-version") {
    const version = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ).version;
    const tag = tagFromEnvironment(env) ?? `v${version}`;
    writeEnvironment("TAG", tag, env);
    writeEnvironment("VERSION", tag.replace(/^v/, ""), env);
    return;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ""))
    throw new Error("GITHUB_REPOSITORY must identify owner/repository");
  if (mode === "unsigned-artifact") {
    if (!/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? ""))
      throw new Error("Invalid workflow run ID");
    const pages = request([
      `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/artifacts?per_page=100`,
      "--paginate",
      "--slurp",
    ]);
    const artifacts = pages
      .flatMap((page) => page.artifacts)
      .filter(
        (artifact) => artifact.name === "unsigned-nsis" && !artifact.expired,
      );
    if (
      artifacts.length !== 1 ||
      !Number.isSafeInteger(artifacts[0].id) ||
      artifacts[0].id <= 0
    )
      throw new Error(
        "The current run must have exactly one unsigned-nsis artifact",
      );
    writeOutput("artifact-id", artifacts[0].id, env);
    return;
  }
  if (mode === "publish-release") {
    if (!/^[1-9]\d*$/.test(env.RELEASE_ID ?? ""))
      throw new Error("Invalid release ID");
    request(
      [
        `repos/${env.GITHUB_REPOSITORY}/releases/${env.RELEASE_ID}`,
        "--method",
        "PATCH",
      ],
      { draft: false, make_latest: "legacy" },
    );
    return;
  }
  throw new Error(`Unknown GitHub Actions operation: ${mode}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new Error("A single GitHub Actions operation is required");
    runAction(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

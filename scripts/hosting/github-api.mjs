import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { repositoryConfig } from "../repository-lib.mjs";

export function githubRequest(
  args,
  body,
  { config = repositoryConfig, run = execFileSync } = {},
) {
  if (config.hosting.provider !== "github")
    throw new Error(`No GitHub API adapter for: ${config.hosting.provider}`);
  const endpoint = new URL(
    args[0],
    `${config.hosting.apiBaseUrl.replace(/\/$/, "")}/`,
  ).href;
  const result = run(
    "gh",
    [
      "api",
      endpoint,
      ...args.slice(1),
      ...(body === undefined ? [] : ["--input", "-"]),
    ],
    {
      cwd: resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"],
      input: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return result.trim() ? JSON.parse(result) : undefined;
}

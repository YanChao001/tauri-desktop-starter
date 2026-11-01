import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubRequest } from "./hosting/github-api.mjs";
import { writeOutput } from "./hosting/github-env.mjs";

// 用实际检出的合并结果匹配；workflow run 的 head_sha 只是 PR 源分支。
export function findVerifiedTreeRun(
  tree,
  { env = process.env, request = githubRequest, warn = console.warn } = {},
) {
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") return undefined;
  if (!/^[a-f\d]{40,64}$/i.test(tree)) throw new Error("Invalid Git tree");
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ""))
    throw new Error("GITHUB_REPOSITORY must identify owner/repository");
  try {
    const prefix = `repos/${env.GITHUB_REPOSITORY}/actions`;
    const name = `ci-tree-v1-${tree}`;
    const { artifacts } = request([
      `${prefix}/artifacts?name=${name}&per_page=100`,
    ]);
    for (const artifact of artifacts) {
      const source = artifact.workflow_run;
      if (
        artifact.name !== name ||
        artifact.expired ||
        !source?.repository_id ||
        source.head_repository_id !== source.repository_id
      )
        continue;
      const run = request([`${prefix}/runs/${artifact.workflow_run.id}`]);
      if (
        run.path === ".github/workflows/ci.yml" &&
        run.status === "completed" &&
        run.conclusion === "success"
      )
        return run;
    }
  } catch (error) {
    warn(`Unable to reuse CI; running checks: ${error.message}`);
  }
  return undefined;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const run = findVerifiedTreeRun(tree);
  writeOutput("tree", tree);
  writeOutput("reused_run", run?.id ?? "");
  const message = run
    ? `Reusing successful CI for Git tree ${tree}: ${run.html_url}`
    : `Running checks for Git tree ${tree}.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

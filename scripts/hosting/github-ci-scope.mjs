import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const full = { docsOnly: false, rustRequired: true };

function isDocumentation(path) {
  return (
    /^(?:README(?:\.en)?|AGENTS|CONTRIBUTING|SECURITY)\.md$/.test(path) ||
    path === "LICENSE" ||
    /^docs\/.+\.md$/.test(path) ||
    /^docs\/assets\/.+\.(?:png|jpe?g|svg|webp)$/.test(path)
  );
}

export function classifyChanges(paths) {
  if (!paths.length) return { ...full };
  const docsOnly = paths.every(isDocumentation);
  const frontendOnly = paths.every(
    (path) =>
      isDocumentation(path) ||
      (!path.startsWith("src/lib/generated/") &&
        /^src\/.+\.(?:tsx?|css)$/.test(path)) ||
      path.startsWith("public/") ||
      /^e2e\/browser\/.+\.ts$/.test(path) ||
      /^(?:index\.html|tsconfig(?:\.[\w-]+)?\.json|vite\.config\.ts|playwright\.config\.ts)$/.test(
        path,
      ),
  );
  return { docsOnly, rustRequired: !frontendOnly };
}

export function detectChanges(
  eventName,
  event,
  { cwd, warn = console.warn } = {},
) {
  if (!["push", "pull_request"].includes(eventName)) return { ...full };
  const base = event.pull_request?.base?.sha ?? event.before;
  const head = event.pull_request?.head?.sha ?? event.after;
  if (
    !/^[a-f\d]{40,64}$/i.test(base ?? "") ||
    !/^[a-f\d]{40,64}$/i.test(head ?? "") ||
    /^0+$/.test(base)
  )
    return { ...full };
  try {
    const revisions =
      eventName === "pull_request" ? [`${base}...${head}`] : [base, head];
    // 禁用重命名检测，保留从源码移入文档目录时删除的一端。
    const paths = execFileSync(
      "git",
      ["diff", "--no-renames", "--name-only", "-z", ...revisions, "--"],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .split("\0")
      .filter(Boolean);
    return classifyChanges(paths);
  } catch (error) {
    warn(
      `Unable to determine changed paths; running all checks: ${error.message}`,
    );
    return { ...full };
  }
}

export function runScope() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const scope = detectChanges(process.env.GITHUB_EVENT_NAME, event);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `docs_only=${scope.docsOnly}\nrust_required=${scope.rustRequired}\n`,
  );
  console.log(JSON.stringify(scope));
}

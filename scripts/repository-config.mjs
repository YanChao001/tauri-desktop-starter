import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { applyFileChanges, projectFile } from "./fs-utils.mjs";
import { validateRepositoryConfig } from "./repository-lib.mjs";
import { formatRepositoryLink } from "../src/config/repository-links.mjs";

function filesUnder(root, directory, accept) {
  const path = join(root, directory);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const name = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return filesUnder(root, name, accept);
    return entry.isFile() && accept(name) ? [name] : [];
  });
}

function publicApp(app) {
  return Object.fromEntries(
    ["repositoryUrl", "docsUrl", "homepageUrl"].map((key) => [key, app[key]]),
  );
}

function updateLinks(content, previous, next) {
  const exact = new Map([
    [previous.app.docsUrl, next.app.docsUrl],
    [previous.app.homepageUrl, next.app.homepageUrl],
    [previous.app.repositoryUrl, next.app.repositoryUrl],
  ]);
  const previousRepo = previous.app.repositoryUrl.replace(/\/$/, "");
  const nextRepo = next.app.repositoryUrl.replace(/\/$/, "");
  const releases = (state) =>
    formatRepositoryLink(
      state.config.hosting.links.releases,
      state.app.repositoryUrl,
    );
  exact.set(releases(previous), releases(next));
  exact.set(
    formatRepositoryLink(
      previous.config.hosting.links.releases,
      next.app.repositoryUrl,
    ),
    releases(next),
  );
  const marker = "__managed_file__";
  const source = (state) =>
    formatRepositoryLink(
      state.config.hosting.links.file,
      state.app.repositoryUrl,
      { ref: state.config.hosting.defaultBranch, path: marker },
    );
  const filePatterns = [previous, { ...previous, app: next.app }].map((state) =>
    source(state).split(marker),
  );
  return content.replace(/https:\/\/[^\s)<>"'`]+/g, (url) => {
    if (exact.has(url)) return exact.get(url);
    for (const [oldFilePrefix, oldFileSuffix] of filePatterns) {
      if (
        !url.startsWith(oldFilePrefix) ||
        (oldFileSuffix && !url.endsWith(oldFileSuffix))
      )
        continue;
      const path = decodeURI(
        url.slice(
          oldFilePrefix.length,
          oldFileSuffix ? -oldFileSuffix.length : undefined,
        ),
      );
      return formatRepositoryLink(
        next.config.hosting.links.file,
        next.app.repositoryUrl,
        { ref: next.config.hosting.defaultBranch, path },
      );
    }
    return url.startsWith(`${previousRepo}/`)
      ? `${nextRepo}${url.slice(previousRepo.length)}`
      : url;
  });
}

/** 只管理明确的项目链接和接线值，所有写入沿用预检/原子替换/冲突保留。 */
export function prepareRepositorySync(root) {
  root = resolve(root);
  const read = (name) => readFileSync(projectFile(root, name), "utf8");
  const app = publicApp(JSON.parse(read("app.config.json")));
  for (const value of Object.values(app)) formatRepositoryLink(value, "");
  const config = validateRepositoryConfig(
    JSON.parse(read("repository.config.json")),
  );
  const previous = JSON.parse(read("repository.generated.json"));
  if (previous.schemaVersion !== 1 || !previous.app || !previous.config)
    throw new Error(
      "Invalid repository.generated.json; restore the last synchronized state",
    );
  validateRepositoryConfig(previous.config);
  const next = { schemaVersion: 1, app, config };
  const changes = [];
  const edit = (name, transform) => {
    if (!existsSync(join(root, name))) return;
    const before = read(name);
    const content = transform(before);
    if (before !== content) changes.push({ path: name, before, content });
  };
  for (const name of [
    "README.md",
    "README.en.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ...filesUnder(root, "docs", (name) => name.endsWith(".md")),
  ])
    edit(name, (content) => updateLinks(content, previous, next));
  edit(".gitmodules", (content) => {
    const sections = [
      ...content.matchAll(
        /^\[submodule "marketplace"\][^\r\n]*(?:\r?\n|$)[\s\S]*?(?=^\[|(?![\s\S]))/gm,
      ),
    ];
    const section = sections[0];
    const pattern = /^(\s*url\s*=\s*)[^\r\n]+/gm;
    if (sections.length !== 1 || [...section[0].matchAll(pattern)].length !== 1)
      throw new Error("Missing marketplace submodule URL");
    const updated = section[0].replace(
      pattern,
      (_, prefix) => prefix + config.marketplace.gitUrl,
    );
    return (
      content.slice(0, section.index) +
      updated +
      content.slice(section.index + section[0].length)
    );
  });
  edit(".github/workflows/ci.yml", (content) => {
    const pattern = /^(\s*branches: )\[[^\r\n]*\]$/gm;
    if ([...content.matchAll(pattern)].length !== 2)
      throw new Error(
        "CI push and pull request branch filters must remain managed",
      );
    return content.replace(
      pattern,
      (_, prefix) =>
        `${prefix}[${config.hosting.defaultBranch}, ${config.hosting.releaseBranch}]`,
    );
  });
  edit(".github/workflows/pages.yml", (content) => {
    const branches = /^(\s*branches: )\[[^\r\n]*\]$/gm;
    const condition = /(^\s*if: github\.ref == ')refs\/heads\/[^'\r\n]+(')/gm;
    if (
      [...content.matchAll(branches)].length !== 1 ||
      [...content.matchAll(condition)].length !== 1
    )
      throw new Error(
        "Pages branch filter and deployment condition must remain managed",
      );
    return content
      .replace(
        branches,
        (_, prefix) => `${prefix}[${config.hosting.defaultBranch}]`,
      )
      .replace(
        condition,
        (_, prefix, suffix) =>
          `${prefix}refs/heads/${config.hosting.defaultBranch}${suffix}`,
      );
  });
  edit(".github/dependabot.yml", (content) => {
    const pattern = /^(\s*target-branch: )[^\r\n]+/gm;
    const count = [...content.matchAll(/^ {2}- package-ecosystem: /gm)].length;
    if (!count || [...content.matchAll(pattern)].length !== count)
      throw new Error(
        "Every Dependabot update entry must have one managed target-branch",
      );
    return content.replace(
      pattern,
      (_, prefix) => prefix + JSON.stringify(config.hosting.defaultBranch),
    );
  });
  if (!isDeepStrictEqual(previous, next)) {
    const before = read("repository.generated.json");
    changes.push({
      path: "repository.generated.json",
      before,
      content: JSON.stringify(next, null, 2) + "\n",
    });
  }
  return { root, changes };
}

/** 只检查可执行的自有源码，第三方来源、文档和固定测试样本由各自契约维护。 */
export function repositoryLiteralViolations(root) {
  const app = JSON.parse(readFileSync(join(root, "app.config.json"), "utf8"));
  const config = JSON.parse(
    readFileSync(join(root, "repository.config.json"), "utf8"),
  );
  const marketUrl = formatRepositoryLink(
    config.hosting.repositoryUrlTemplate,
    "",
    { repository: app.extensionMarket?.repository || "disabled/market" },
  );
  const urls = [app.repositoryUrl, marketUrl];
  const names = ["src", "scripts", "e2e", "src-tauri/src"].flatMap(
    (directory) =>
      filesUnder(
        root,
        directory,
        (name) =>
          /\.(?:[cm]?js|tsx?|rs)$/.test(name) &&
          !/\.test\.|\/test\/|\/test-fixtures\//.test(name),
      ),
  );
  return names.filter((name) => {
    const content = readFileSync(projectFile(root, name), "utf8").split(
      /\n#\[cfg\(test\)\]/,
    )[0];
    return urls.some((url) => content.includes(url));
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [mode, flag, directory, ...rest] = process.argv.slice(2);
    if (
      !["sync", "check"].includes(mode) ||
      rest.length ||
      (flag !== undefined && (flag !== "--root" || !directory))
    )
      throw new Error(
        "Usage: node scripts/repository-config.mjs <sync|check> [--root <directory>]",
      );
    const root = resolve(directory ?? join(import.meta.dirname, ".."));
    const plan = prepareRepositorySync(root);
    const violations = repositoryLiteralViolations(root);
    if (violations.length)
      throw new Error(
        `Project repository URLs must come from configuration: ${violations.join(", ")}`,
      );
    if (mode === "check" && plan.changes.length)
      throw new Error(
        `Repository configuration is out of sync: ${plan.changes.map((change) => change.path).join(", ")}. Run pnpm repository:sync.`,
      );
    if (mode === "sync" && plan.changes.length) {
      applyFileChanges(plan);
      console.log(
        `Synchronized repository configuration: ${plan.changes.map((change) => change.path).join(", ")}`,
      );
    } else console.log("Repository configuration is already synchronized.");
    const marketScript = "marketplace/scripts/repository-config.mjs";
    if (existsSync(join(root, marketScript))) {
      const result = spawnSync(
        process.execPath,
        [
          projectFile(root, marketScript),
          mode,
          "--root",
          join(root, "marketplace"),
        ],
        { encoding: "utf8", windowsHide: true },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          `Marketplace repository configuration check failed: ${result.stderr.trim()}`,
        );
      if (result.stdout.trim()) console.log(result.stdout.trim());
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

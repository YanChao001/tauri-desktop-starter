import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const headings = new Map([
  ["feat", "新功能"],
  ["fix", "问题修复"],
  ["perf", "性能优化"],
  ["refactor", "代码重构"],
  ["docs", "文档"],
  ["build", "构建与依赖"],
  ["ci", "持续集成"],
  ["test", "测试"],
  ["style", "代码风格"],
  ["chore", "维护"],
  ["revert", "回退"],
  ["other", "其他变更"],
]);
const validSha = (value) => /^[a-f0-9]{40}$/i.test(value);
const markdown = (value) =>
  String(value)
    .replace(/\s+/g, " ")
    .replace(/[\\`*_{}[\]()<>|]/g, "\\$&");
const runGit = (args) =>
  execFileSync("git", args, {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });

/** 用确切源码提交和已公开正式标签读取完整历史，不重复罗列合并记录。 */
export function readReleaseCommits(commit, previousTag, git = runGit) {
  if (!validSha(commit)) throw new Error("发布说明需要完整的 40 位源码 SHA");
  if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false")
    throw new Error(
      "发布说明需要完整 Git 历史，请先 git fetch --unshallow --tags",
    );
  const source = git(["rev-parse", "--verify", `${commit}^{commit}`]).trim();
  if (source.toLowerCase() !== commit.toLowerCase())
    throw new Error("发布说明源码提交不匹配");
  let range = source;
  if (previousTag) {
    if (!/^v[0-9][0-9A-Za-z.+-]*$/.test(previousTag))
      throw new Error("发布说明的正式版本标签无效");
    const previous = git([
      "rev-parse",
      "--verify",
      `refs/tags/${previousTag}^{commit}`,
    ]).trim();
    if (!validSha(previous)) throw new Error("发布说明基线提交无效");
    git(["merge-base", "--is-ancestor", previous, source]);
    range = `${previous}..${source}`;
  }
  const fields = git([
    "log",
    "--no-merges",
    "--reverse",
    "--format=%H%x00%B%x00",
    range,
    "--",
  ])
    .trim()
    .split("\0");
  if (fields.length === 1 && fields[0] === "") return [];
  if (fields.pop() !== "" || fields.length % 2 !== 0)
    throw new Error("发布提交历史格式无效");
  const commits = [];
  for (let index = 0; index < fields.length; index += 2) {
    const sha = fields[index].trim();
    const message = fields[index + 1].trim();
    if (!validSha(sha) || !message) throw new Error("发布提交无效");
    commits.push({ sha, message });
  }
  return commits;
}

function conventionalChanges(commits, repository) {
  const groups = new Map([...headings.keys()].map((type) => [type, []]));
  const breaking = [];
  for (const { sha, message } of commits) {
    const [subject] = message.split(/\r?\n/);
    const match = /^([a-z]+)(?:\(([^)\r\n]+)\))?(!)?:[ \t]+(.+)$/.exec(subject);
    const footer = /(?:^|\n)BREAKING[ -]CHANGE:[ \t]*([\s\S]+)/.exec(message);
    const isBreaking = match?.[3] || footer;
    // 只过滤纯升版 / 回流维护提交，不隐藏 fix(release) 或声明破坏性的提交。
    if (match?.[1] === "chore" && match[2] === "release" && !isBreaking)
      continue;
    const type = match && headings.has(match[1]) ? match[1] : "other";
    const scope = match?.[2] ? `**${markdown(match[2])}：** ` : "";
    const item = `${scope}${markdown(match?.[4] ?? subject)} ([${sha.slice(0, 7)}](https://github.com/${repository}/commit/${sha}))`;
    groups.get(type).push(item);
    if (isBreaking) {
      const details = footer?.[1].split(/\n[A-Za-z][A-Za-z-]*:[ \t]/)[0].trim();
      breaking.push(details ? `${item} — ${markdown(details)}` : item);
    }
  }
  const changes = [];
  for (const [type, items] of groups) {
    if (items.length)
      changes.push(
        `### ${headings.get(type)}（${type}）\n\n${items.map((item) => `- ${item}`).join("\n")}`,
      );
  }
  return {
    breaking: breaking.length
      ? breaking.map((item) => `- ${item}`).join("\n")
      : "本次提交未声明破坏性变更；升级前仍须阅读下方限制。",
    changes:
      changes.join("\n\n") ||
      "本次范围没有额外的非合并产品提交，源码差异见完整变更。",
  };
}

/** 读取 PR 的公开说明，忽略模板注释及代码块中的标题。 */
function section(markdown, names) {
  const lines = (markdown ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const headings = [];
  let fence;
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = undefined;
      continue;
    }
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading)
      headings.push({ index, depth: heading[1].length, name: heading[2] });
  }
  for (const name of names) {
    const start = headings.find((heading) => heading.name === name);
    if (!start) continue;
    const end = headings.find(
      (heading) => heading.index > start.index && heading.depth <= start.depth,
    );
    const content = lines
      .slice(start.index + 1, end?.index)
      .join("\n")
      .trim();
    if (content) return content;
  }
  return "";
}

/** 只生成正文；创建草稿和公开发布仍由原发布流程负责。 */
export function generateReleaseNotes(
  { version, repository, commit, releases },
  request,
  git = runGit,
) {
  const tag = `v${version}`;
  const endpoint = `repos/${repository}`;
  const previous = releases
    .filter(
      (release) =>
        !release.draft && !release.prerelease && release.tag_name !== tag,
    )
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  const pulls = request([
    `${endpoint}/commits/${commit}/pulls?per_page=100`,
    "--paginate",
    "--slurp",
  ]).flat();
  const pull = pulls.find(
    (item) =>
      item.merged_at &&
      item.base.ref === "main" &&
      item.merge_commit_sha === commit &&
      ["release", "hotfix"].some(
        (prefix) => item.head.ref === `${prefix}/${version}`,
      ),
  );
  let summary = section(pull?.body, ["变更摘要", "变更内容"]);
  let limitations = section(pull?.body, ["升级与限制", "影响范围"]);
  if (!pull && !previous) {
    summary = "首次公开发布，功能与使用方式见仓库 README。";
    limitations =
      "首次发布没有可验证的历史版本升级路径，安装与签名状态请按发布验收结果确认。";
  } else if (!summary || !limitations) {
    throw new Error(
      `请在合入 main 的 release/${version} 或 hotfix/${version} PR 中填写“变更内容”和“影响范围”（或“变更摘要”和“升级与限制”），再重跑发布；不得用模板注释代替说明`,
    );
  }
  const { changes, breaking } = conventionalChanges(
    readReleaseCommits(commit, previous?.tag_name, git),
    repository,
  );
  const base = previous
    ? `相较上一公开正式版 **${previous.tag_name}**；未公开草稿不作为比较基线。`
    : "首次公开发布。";
  const link = `https://github.com/${repository}`;
  const notes = [
    `## 版本信息\n\n- 版本：**${tag}**\n- 源码：[${commit.slice(0, 7)}](${link}/commit/${commit})`,
    `## 变更摘要\n\n${base}\n\n${summary}`,
    `## 破坏性变更\n\n${breaking}`,
    `## 更新内容\n\n${changes}`,
    `## 升级与限制\n\n${limitations}`,
    `## 下载与系统要求\n\n安装包见下方 Assets，按系统和处理器选择：\n\n| 系统 | 架构 | 安装包 |\n| --- | --- | --- |\n| Windows | x64 | \`*-setup.exe\`（NSIS，按用户安装）或 \`.msi\`（所有用户安装） |\n| macOS | Apple Silicon / Intel | 对应 \`aarch64\` / \`x64\` 的 \`.dmg\`；\`.app.tar.gz\` 用于应用内更新 |\n| Linux | x64 | \`.AppImage\`，或匹配发行版的 \`.deb\` / \`.rpm\` |\n\nWindows 需要受目标系统支持的 WebView2 Runtime；Linux 依赖与安装方式见[平台说明](${link}/blob/${commit}/docs/development.md#环境要求)。本项目尚未声明经安装验收的统一最低系统版本，CI runner 版本不等于最低支持版本；实际系统、签名及升级验收范围以上方限制为准。\n\n使用方式见 [README](${link}/blob/${commit}/README.md)，签名范围与验证方式见[签名策略](${link}/blob/${commit}/docs/code-signing-policy.md)。`,
    `## 完整变更\n\n${previous ? `[${previous.tag_name}...${tag}](${link}/compare/${encodeURIComponent(previous.tag_name)}...${commit})` : `[全部提交](${link}/commits/${commit})`}`,
  ].join("\n\n");
  if (Buffer.byteLength(notes) > 120_000)
    throw new Error("发布说明超过 120,000 字节，请审阅并缩小发布范围");
  return notes;
}

/** 更新弹窗容量有限，优先保留摘要与升级限制，不让长 PR 清单挤掉提醒。 */
export function updaterReleaseNotes(body, { version, repository }) {
  const notes =
    typeof body === "string" && body.trim()
      ? body.trim()
      : `Release v${version}`;
  if (notes.length <= 8000) return notes;
  const summary = section(notes, ["变更摘要"]);
  const breaking = section(notes, ["破坏性变更"]);
  const limitations = section(notes, ["升级与限制"]);
  const link = `完整说明：https://github.com/${repository}/releases/tag/v${version}`;
  if (summary && limitations) {
    const concise = `## 变更摘要\n\n${summary}${breaking ? `\n\n## 破坏性变更\n\n${breaking}` : ""}\n\n## 升级与限制\n\n${limitations}`;
    if (concise.length + link.length + 2 <= 8000)
      return `${concise}\n\n${link}`;
    return `发布说明较长，请先阅读完整变更与升级限制。\n\n${link}`;
  }
  return `${notes.slice(0, 7900)}…\n\n${link}`;
}

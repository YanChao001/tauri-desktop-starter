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
  const generated = request(
    [`${endpoint}/releases/generate-notes`, "--method", "POST"],
    {
      tag_name: tag,
      target_commitish: commit,
      ...(previous ? { previous_tag_name: previous.tag_name } : {}),
    },
  );
  // 版本号和历史回流 PR 不属于产品变更；保留 fix(release) 等实际修复。
  const changes = generated.body
    .split("\n")
    .filter((line) => !/^\s*[*-]\s+chore\(release\):/i.test(line))
    .filter((line) => !/^## What's Changed\s*$/.test(line))
    .map((line) => line.replace(/^## /, "### "))
    .join("\n")
    .replace("**Full Changelog**:", "**完整变更**：")
    .trim();
  const base = previous
    ? `相较上一公开正式版 **${previous.tag_name}**；未公开草稿不作为比较基线。`
    : "首次公开发布。";
  return [
    `## 变更摘要\n\n${base}\n\n${summary}`,
    `## 合并的 PR\n\n${changes || "本次没有额外的 PR 记录。"}`,
    `## 升级与限制\n\n${limitations}`,
    `安装包见下方 Assets；使用方式见 [README](https://github.com/${repository}/blob/${tag}/README.md)，签名范围与验证方式见[签名策略](https://github.com/${repository}/blob/${tag}/docs/code-signing-policy.md)。`,
  ].join("\n\n");
}

/** 更新弹窗容量有限，优先保留摘要与升级限制，不让长 PR 清单挤掉提醒。 */
export function updaterReleaseNotes(body, { version, repository }) {
  const notes =
    typeof body === "string" && body.trim()
      ? body.trim()
      : `Release v${version}`;
  if (notes.length <= 8000) return notes;
  const summary = section(notes, ["变更摘要"]);
  const limitations = section(notes, ["升级与限制"]);
  const link = `完整说明：https://github.com/${repository}/releases/tag/v${version}`;
  if (summary && limitations) {
    const concise = `## 变更摘要\n\n${summary}\n\n## 升级与限制\n\n${limitations}`;
    if (concise.length + link.length + 2 <= 8000)
      return `${concise}\n\n${link}`;
    return `发布说明较长，请先阅读完整变更与升级限制。\n\n${link}`;
  }
  return `${notes.slice(0, 7900)}…\n\n${link}`;
}

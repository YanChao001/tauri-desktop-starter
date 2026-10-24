import assert from "node:assert/strict";
import { test } from "node:test";
import { generateReleaseNotes, updaterReleaseNotes } from "./release-notes.mjs";

const options = {
  version: "1.2.3",
  repository: "owner/starter",
  commit: "release-merge",
  releases: [
    { tag_name: "v1.2.2", published_at: "2026-10-01T00:00:00Z" },
    { tag_name: "v1.2.3", published_at: "2026-10-04T00:00:00Z" },
    {
      tag_name: "v1.2.3-beta.1",
      prerelease: true,
      published_at: "2026-10-03T00:00:00Z",
    },
    {
      tag_name: "v1.2.2-fix",
      draft: true,
      published_at: "2026-10-02T00:00:00Z",
    },
  ],
};
const pull = {
  base: { ref: "main" },
  head: { ref: "release/1.2.3" },
  merge_commit_sha: options.commit,
  merged_at: "2026-10-05T00:00:00Z",
  body: "## 变更内容\n\n修复导航等待。\n\n## 验证结果\n\n通过。\n\n## 影响范围\n\n未完成跨版本安装验收。",
};

test("notes use the published stable base and release PR, omitting administrative PRs", () => {
  const notes = generateReleaseNotes(options, (args, body) => {
    if (!body)
      return [
        [{ ...pull, base: { ref: "develop" }, body: "错误的回流说明" }, pull],
      ];
    assert.equal(body.previous_tag_name, "v1.2.2");
    assert.equal(body.target_commitish, options.commit);
    return {
      body: "## What's Changed\n* chore(release): 发布 by @owner in https://github.com/owner/starter/pull/1\n* fix(release): 修复并发 by @owner in https://github.com/owner/starter/pull/2\n\n**Full Changelog**: https://github.com/owner/starter/compare/v1.2.2...v1.2.3",
    };
  });
  assert.match(notes, /修复导航等待/);
  assert.match(notes, /未完成跨版本安装验收/);
  assert.match(notes, /fix\(release\).*pull\/2/);
  assert.match(notes, /compare\/v1\.2\.2\.\.\.v1\.2\.3/);
  assert.doesNotMatch(
    notes,
    /chore\(release\)|错误的回流说明|通过。|What's Changed/,
  );
});

test("explicit release sections take priority and fenced headings do not end them", () => {
  const notes = generateReleaseNotes(options, (_args, body) =>
    body
      ? { body: "" }
      : [
          [
            {
              ...pull,
              head: { ref: "hotfix/1.2.3" },
              body: "## 变更内容\n内部实现。\n### 变更摘要\n用户可见修复。\n```md\n## 示例标题\n```\n## 影响范围\n内部权限说明。\n### 升级与限制\n<!-- 填写真实情况 -->\n需手动安装。\n## 验证结果\n内部测试。",
            },
          ],
        ],
  );
  assert.match(notes, /用户可见修复/);
  assert.match(notes, /示例标题/);
  assert.match(notes, /需手动安装/);
  assert.doesNotMatch(notes, /内部|填写真实情况/);
});

test("missing PR, wrong source and empty template sections stop before creating notes", () => {
  for (const pulls of [
    [],
    [{ ...pull, merge_commit_sha: "other" }],
    [
      {
        ...pull,
        body: "## 变更内容\n<!-- 待填 -->\n## 影响范围\n<!-- 待填 -->",
      },
    ],
  ]) {
    assert.throws(
      () =>
        generateReleaseNotes(options, (_args, body) => {
          assert.equal(body, undefined);
          return [pulls];
        }),
      /填写/,
    );
  }
});

test("first publication has an honest fallback and no explicit comparison tag", () => {
  const notes = generateReleaseNotes(
    { ...options, releases: [] },
    (_args, body) => {
      if (!body) return [[]];
      assert.equal(body.previous_tag_name, undefined);
      return { body: "" };
    },
  );
  assert.match(notes, /首次公开发布/);
  assert.match(notes, /没有可验证的历史版本升级路径/);
});

test("long updater notes retain summary and limitations instead of the PR list", () => {
  const body = `## 变更摘要\n\n更快导航。\n\n## 升级与限制\n\n未验收旧版升级。\n\n## 合并的 PR\n\n${"* change\n".repeat(1500)}`;
  const notes = updaterReleaseNotes(body, options);
  assert.ok(notes.length <= 8000);
  assert.match(notes, /更快导航/);
  assert.match(notes, /未验收旧版升级/);
  assert.match(notes, /releases\/tag\/v1\.2\.3/);
  assert.doesNotMatch(notes, /change/);
  assert.equal(updaterReleaseNotes("原有说明", options), "原有说明");
});

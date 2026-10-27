import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateReleaseNotes,
  readReleaseCommits,
  updaterReleaseNotes,
} from "./release-notes.mjs";

const sourceSha = "a".repeat(40);
const previousSha = "b".repeat(40);
const history =
  (messages = [], commands = []) =>
  (args) => {
    commands.push(args);
    if (args[1] === "--is-shallow-repository") return "false";
    if (args[0] === "rev-parse")
      return args[2] === `${sourceSha}^{commit}` ? sourceSha : previousSha;
    if (args[0] === "log")
      return messages
        .map(
          (message, index) =>
            `${String(index).padStart(40, "0")}\0${message}\n\0\n`,
        )
        .join("");
    return "";
  };

const options = {
  version: "1.2.3",
  repository: "owner/starter",
  commit: sourceSha,
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

test("notes use the published stable base and release PR, classifying real commits", () => {
  const commands = [];
  const notes = generateReleaseNotes(
    options,
    (args) => {
      assert.ok(args[0].includes(`/commits/${sourceSha}/pulls?`));
      return [
        [{ ...pull, base: { ref: "develop" }, body: "错误的回流说明" }, pull],
      ];
    },
    history(
      [
        "feat(ui): 添加导航",
        "chore(release): 发布",
        "fix(release): 修复并发",
        "docs: 更新说明",
      ],
      commands,
    ),
  );
  assert.match(notes, /修复导航等待/);
  assert.match(notes, /未完成跨版本安装验收/);
  assert.match(notes, /### 新功能（feat）/);
  assert.match(notes, /### 问题修复（fix）/);
  assert.match(notes, /release：.*修复并发/);
  assert.match(notes, /### 文档（docs）/);
  assert.ok(notes.includes(`/compare/v1.2.2...${sourceSha}`));
  assert.ok(commands.some((args) => args[2] === "refs/tags/v1.2.2^{commit}"));
  assert.ok(
    commands.some((args) => args.includes(`${previousSha}..${sourceSha}`)),
  );
  assert.match(notes, /WebView2 Runtime/);
  assert.match(notes, /aarch64.*x64/);
  assert.match(notes, /尚未声明经安装验收的统一最低系统版本/);
  assert.doesNotMatch(
    notes,
    /chore\(release\)|错误的回流说明|通过。|What's Changed/,
  );
});

test("explicit release sections take priority and fenced headings do not end them", () => {
  const notes = generateReleaseNotes(
    options,
    () => [
      [
        {
          ...pull,
          head: { ref: "hotfix/1.2.3" },
          body: "## 变更内容\n内部实现。\n### 变更摘要\n用户可见修复。\n```md\n## 示例标题\n```\n## 影响范围\n内部权限说明。\n### 升级与限制\n<!-- 填写真实情况 -->\n需手动安装。\n## 验证结果\n内部测试。",
        },
      ],
    ],
    history(),
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
        generateReleaseNotes(
          options,
          (_args, body) => {
            assert.equal(body, undefined);
            return [pulls];
          },
          history(),
        ),
      /填写/,
    );
  }
});

test("first publication has an honest fallback and no explicit comparison tag", () => {
  const notes = generateReleaseNotes(
    { ...options, releases: [] },
    () => [[]],
    history(["feat: 初始版本"]),
  );
  assert.match(notes, /首次公开发布/);
  assert.match(notes, /没有可验证的历史版本升级路径/);
  assert.ok(notes.includes(`/commits/${sourceSha}`));
});

test("long updater notes retain summary, breaking changes and limitations", () => {
  const body = `## 变更摘要\n\n更快导航。\n\n## 破坏性变更\n\n导出旧数据再升级。\n\n## 升级与限制\n\n未验收旧版升级。\n\n## 更新内容\n\n${"* change\n".repeat(1500)}`;
  const notes = updaterReleaseNotes(body, options);
  assert.ok(notes.length <= 8000);
  assert.match(notes, /更快导航/);
  assert.match(notes, /未验收旧版升级/);
  assert.match(notes, /导出旧数据再升级/);
  assert.match(notes, /releases\/tag\/v1\.2\.3/);
  assert.doesNotMatch(notes, /change/);
  assert.equal(updaterReleaseNotes("原有说明", options), "原有说明");
});

test("all Conventional Commit types and breaking footers remain visible and escaped", () => {
  const messages = [
    "feat(api)!: 修改接口\n\nBREAKING CHANGE: 先导出原始数据\n  再手动导入\nRefs: #42",
    "fix(data): 修改协议\n\nBREAKING-CHANGE: 重新选择数据源",
    "perf: 提升性能",
    "refactor: 简化组件",
    "build: 调整打包",
    "ci: 固定依赖",
    "test: 增加回归",
    "style: 格式调整",
    "chore: 更新忽略",
    "revert: 回退错误",
    "旧式提交 [链接](url) <b>",
    "chore(release)!: 调整发布通道",
  ];
  const notes = generateReleaseNotes(
    options,
    () => [[pull]],
    history(messages),
  );
  for (const type of [
    "feat",
    "fix",
    "perf",
    "refactor",
    "build",
    "ci",
    "test",
    "style",
    "chore",
    "revert",
    "other",
  ])
    assert.ok(notes.includes(`（${type}）`), type);
  assert.ok(
    notes.indexOf("先导出原始数据 再手动导入") < notes.indexOf("## 更新内容"),
  );
  assert.match(notes, /重新选择数据源/);
  assert.match(notes, /调整发布通道/);
  assert.doesNotMatch(notes, /Refs: #42/);
  assert.ok(notes.includes("\\[链接\\]\\(url\\) \\<b\\>"));
  assert.throws(
    () =>
      generateReleaseNotes(
        options,
        () => [[pull]],
        history(["feat: " + "x".repeat(120_000)]),
      ),
    /120,000/,
  );
});

test("complete Git history supports annotated baselines, merge exclusion and empty ranges", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-release-notes-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Release fixture"]);
  git(["config", "user.email", "release@example.test"]);
  git(["commit", "--allow-empty", "-m", "feat: 初始版本"]);
  const initial = git(["rev-parse", "HEAD"]).trim();
  git(["tag", "-a", "v1.0.0", "-m", "版本 1.0.0"]);
  git(["switch", "-c", "feature/nav"]);
  git(["commit", "--allow-empty", "-m", "feat(ui): 添加导航"]);
  git(["commit", "--allow-empty", "-m", "fix(ui): 修复焦点"]);
  git(["switch", "main"]);
  git(["merge", "--no-ff", "feature/nav", "-m", "Merge pull request #1"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  assert.deepEqual(
    readReleaseCommits(head, "v1.0.0", git).map((commit) => commit.message),
    ["feat(ui): 添加导航", "fix(ui): 修复焦点"],
  );
  assert.equal(readReleaseCommits(head, undefined, git).length, 3);
  git(["tag", "v1.1.0"]);
  assert.deepEqual(readReleaseCommits(head, "v1.1.0", git), []);
  assert.throws(() => readReleaseCommits(initial, "v1.1.0", git));
  assert.throws(() => readReleaseCommits(head, "v9.9.9", git));
  assert.throws(
    () =>
      readReleaseCommits(head, undefined, (args) =>
        args[1] === "--is-shallow-repository" ? "true" : git(args),
      ),
    /完整 Git 历史/,
  );
});

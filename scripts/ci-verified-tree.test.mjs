import assert from "node:assert/strict";
import test from "node:test";
import { findVerifiedTreeRun } from "./ci-verified-tree.mjs";

const tree = "a".repeat(40);
const env = {
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_EVENT_NAME: "pull_request",
};
const artifact = {
  name: `ci-tree-v1-${tree}`,
  expired: false,
  workflow_run: { id: 123, repository_id: 42, head_repository_id: 42 },
};
const success = {
  id: 123,
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
  // PR 源分支 SHA 与实际检出的 merge commit 不同，不能用它代替 tree。
  head_sha: "b".repeat(40),
};

test("reuse matches the checked tree marker and a successful CI workflow", () => {
  const calls = [];
  const request = ([endpoint]) => {
    calls.push(endpoint);
    return endpoint.includes("/artifacts?")
      ? { artifacts: [artifact] }
      : success;
  };
  assert.equal(findVerifiedTreeRun(tree, { env, request }), success);
  assert.deepEqual(calls, [
    `repos/owner/repo/actions/artifacts?name=ci-tree-v1-${tree}&per_page=100`,
    "repos/owner/repo/actions/runs/123",
  ]);
});

test("different trees, expired evidence and unsuccessful or unrelated workflows cannot reuse", () => {
  for (const candidate of [
    { ...artifact, name: `ci-tree-v1-${"c".repeat(40)}` },
    { ...artifact, expired: true },
    {
      ...artifact,
      workflow_run: { ...artifact.workflow_run, head_repository_id: 99 },
    },
  ]) {
    const request = () => ({ artifacts: [candidate] });
    assert.equal(findVerifiedTreeRun(tree, { env, request }), undefined);
  }
  for (const candidate of [
    { ...success, conclusion: "failure" },
    { ...success, conclusion: "cancelled" },
    { ...success, status: "in_progress", conclusion: null },
    { ...success, path: ".github/workflows/release.yml" },
  ]) {
    const request = ([endpoint]) =>
      endpoint.includes("/artifacts?") ? { artifacts: [artifact] } : candidate;
    assert.equal(findVerifiedTreeRun(tree, { env, request }), undefined);
  }
});

test("missing or unavailable evidence runs checks; manual dispatch always runs fresh checks", () => {
  assert.equal(
    findVerifiedTreeRun(tree, { env, request: () => ({ artifacts: [] }) }),
    undefined,
  );
  const warnings = [];
  assert.equal(
    findVerifiedTreeRun(tree, {
      env,
      request: () => {
        throw new Error("API unavailable");
      },
      warn: (message) => warnings.push(message),
    }),
    undefined,
  );
  assert.equal(warnings.length, 1);
  assert.equal(
    findVerifiedTreeRun(tree, {
      env: { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" },
      request: () => assert.fail("manual dispatch must bypass reuse"),
    }),
    undefined,
  );
});

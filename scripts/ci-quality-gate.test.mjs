import assert from "node:assert/strict";
import test from "node:test";
import { qualityGateFailures } from "./ci-quality-gate.mjs";

function results(
  outputs = { docs_only: "false", rust_required: "true", sdk_required: "true" },
) {
  return {
    changes: { result: "success", outputs },
    frontend: { result: "success" },
    "browser-smoke": { result: "success" },
    rust: { result: "success" },
    bindings: { result: "success" },
    "extension-sdk": { result: "success" },
    "desktop-e2e": { result: "success" },
  };
}

test("the gate accepts complete runs and only the skips allowed by the scope", () => {
  assert.deepEqual(qualityGateFailures(results()), []);
  const docs = results({
    docs_only: "true",
    rust_required: "false",
    sdk_required: "false",
  });
  for (const job of [
    "browser-smoke",
    "rust",
    "bindings",
    "extension-sdk",
    "desktop-e2e",
  ]) {
    docs[job].result = "skipped";
  }
  assert.deepEqual(qualityGateFailures(docs), []);
  const frontend = results({
    docs_only: "false",
    rust_required: "false",
    sdk_required: "false",
  });
  frontend.rust.result = "skipped";
  frontend.bindings.result = "skipped";
  frontend["extension-sdk"].result = "skipped";
  assert.deepEqual(qualityGateFailures(frontend), []);
  for (const job of ["browser-smoke", "desktop-e2e"]) {
    const skipped = structuredClone(frontend);
    skipped[job].result = "skipped";
    assert.equal(qualityGateFailures(skipped).length, 1, job);
  }
});

test("failed or cancelled jobs cannot be hidden by scope-based skips", () => {
  for (const job of Object.keys(results())) {
    for (const result of ["failure", "cancelled", "timed_out"]) {
      const needs = results({ docs_only: "true", rust_required: "false" });
      needs[job].result = result;
      assert.equal(qualityGateFailures(needs).length, 1, `${job}: ${result}`);
    }
  }
});

test("unexpected skips, missing jobs and missing scope outputs fail closed", () => {
  for (const job of Object.keys(results())) {
    const skipped = results();
    skipped[job].result = "skipped";
    assert.equal(qualityGateFailures(skipped).length, 1, job);
    const missing = results();
    delete missing[job];
    assert.ok(qualityGateFailures(missing).length >= 1, job);
  }
  const needs = results({});
  needs.rust.result = "skipped";
  needs.bindings.result = "skipped";
  needs["extension-sdk"].result = "skipped";
  assert.equal(qualityGateFailures(needs).length, 3);
});

test("SDK skips depend on SDK inputs, independently of native checks", () => {
  const needs = results();
  delete needs["extension-sdk"];
  assert.equal(qualityGateFailures(needs).length, 1);
  needs["extension-sdk"] = { result: "skipped" };
  assert.equal(qualityGateFailures(needs).length, 1);
  needs["extension-sdk"].result = "success";
  assert.deepEqual(qualityGateFailures(needs), []);
  const unrelated = results({ rust_required: "true", sdk_required: "false" });
  unrelated["extension-sdk"].result = "skipped";
  assert.deepEqual(qualityGateFailures(unrelated), []);
  unrelated.rust.result = "skipped";
  assert.equal(qualityGateFailures(unrelated).length, 1);
});

test("verified tree reuse permits skipped checks but never failures or a failed scope job", () => {
  const reused = results({ reused_run: "123" });
  for (const [job, value] of Object.entries(reused)) {
    if (job !== "changes") value.result = "skipped";
  }
  assert.deepEqual(qualityGateFailures(reused), []);
  reused.rust.result = "failure";
  assert.equal(qualityGateFailures(reused).length, 1);
  reused.rust.result = "skipped";
  reused.changes.result = "failure";
  assert.equal(qualityGateFailures(reused).length, 1);
  reused.changes.result = "success";
  reused.changes.outputs.reused_run = "invalid";
  assert.equal(qualityGateFailures(reused).length, 6);
});

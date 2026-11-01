import assert from "node:assert/strict";
import test from "node:test";
import { qualityGateFailures } from "./ci-quality-gate.mjs";

function results(outputs = { docs_only: "false", rust_required: "true" }) {
  return {
    changes: { result: "success", outputs },
    frontend: { result: "success" },
    "browser-smoke": { result: "success" },
    rust: { result: "success" },
    bindings: { result: "success" },
    "desktop-e2e": { result: "success" },
  };
}

test("the gate accepts complete runs and only the skips allowed by the scope", () => {
  assert.deepEqual(qualityGateFailures(results()), []);
  const docs = results({ docs_only: "true", rust_required: "false" });
  for (const job of ["browser-smoke", "rust", "bindings", "desktop-e2e"]) {
    docs[job].result = "skipped";
  }
  assert.deepEqual(qualityGateFailures(docs), []);
  const frontend = results({ docs_only: "false", rust_required: "false" });
  frontend.rust.result = "skipped";
  frontend.bindings.result = "skipped";
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
  assert.equal(qualityGateFailures(needs).length, 2);
});

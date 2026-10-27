import assert from "node:assert/strict";
import test from "node:test";
import { parseVerifyArgs, pnpmCommand, runVerification } from "./verify.mjs";

test("verification bounds parallel groups and builds only after all checks pass", async () => {
  const pending = new Set();
  let maximum = 0;
  const completed = [];
  const report = await runVerification({
    jobs: 2,
    async runTask(name) {
      if (name === "vite build") {
        assert.equal(pending.size, 0);
        assert.ok(completed.includes("typecheck"));
        assert.ok(completed.includes("test:scripts"));
        assert.ok(completed.includes("extension:demos:check"));
      }
      if (name === "test:scripts") assert.ok(!pending.has("test"));
      pending.add(name);
      maximum = Math.max(maximum, pending.size);
      await new Promise((done) => setImmediate(done));
      pending.delete(name);
      completed.push(name);
    },
  });
  assert.equal(maximum, 2);
  assert.equal(report.ok, true);
  assert.equal(completed.at(-1), "vite build");
});

test("a failed check preserves remaining checks and prevents the build", async () => {
  const completed = [];
  const report = await runVerification({
    jobs: 3,
    async runTask(name) {
      completed.push(name);
      if (name === "format:check") throw new Error("format failure");
    },
  });
  assert.equal(report.ok, false);
  assert.ok(completed.includes("lint"));
  assert.ok(completed.includes("typecheck"));
  assert.ok(completed.includes("test:scripts"));
  assert.ok(!completed.includes("vite build"));
  assert.equal(
    report.results.find((result) => !result.ok).error.message,
    "format failure",
  );
});

test("a failed final build fails verification", async () => {
  const report = await runVerification({
    jobs: 1,
    async runTask(name) {
      if (name === "vite build") throw new Error("build failure");
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.results.at(-1).name, "vite build");
  assert.equal(report.results.at(-1).ok, false);
});

test("cancellation stops scheduling checks and prevents the build", async () => {
  const controller = new AbortController();
  const started = [];
  const report = await runVerification({
    jobs: 1,
    signal: controller.signal,
    async runTask(name) {
      started.push(name);
      controller.abort();
    },
  });
  assert.equal(report.ok, false);
  assert.deepEqual(started, ["test"]);
});

test("parallel cancellation waits for all in-flight tasks to finish cleanup", async () => {
  const controller = new AbortController();
  const started = [];
  const cleanup = [];
  let allStarted;
  const ready = new Promise((done) => {
    allStarted = done;
  });
  const verification = runVerification({
    jobs: 2,
    signal: controller.signal,
    runTask(name, signal) {
      started.push(name);
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            cleanup.push(() => reject(signal.reason));
          },
          { once: true },
        );
        if (started.length === 2) allStarted();
      });
    },
  });
  await ready;
  controller.abort(new Error("cancel"));
  let finished = false;
  void verification.then(() => {
    finished = true;
  });
  cleanup[0]();
  await new Promise((done) => setImmediate(done));
  assert.equal(finished, false);
  cleanup[1]();
  const report = await verification;
  assert.equal(report.ok, false);
  assert.deepEqual(started, ["test", "format:check"]);
  assert.equal(
    report.results.every((result) => !result.ok),
    true,
  );
});

test("verification accepts bounded concurrency and a serial fallback", () => {
  assert.equal(parseVerifyArgs(["--jobs", "1"]).jobs, 1);
  assert.equal(parseVerifyArgs(["--jobs=3"]).jobs, 3);
  assert.equal(parseVerifyArgs(["--help"]).help, true);
  for (const args of [
    ["--jobs=0"],
    ["--jobs", "4"],
    ["--jobs", "2", "extra"],
    ["--unknown"],
  ])
    assert.throws(() => parseVerifyArgs(args));
});

test("pnpm runs scripts and standalone executables without a shell", () => {
  const args = ["run", "test:scripts"];
  assert.deepEqual(pnpmCommand("C:/Program Files/pnpm.cjs", args), [
    process.execPath,
    ["C:/Program Files/pnpm.cjs", ...args],
  ]);
  assert.deepEqual(pnpmCommand("C:/Program Files/pnpm.exe", args), [
    "C:/Program Files/pnpm.exe",
    args,
  ]);
});

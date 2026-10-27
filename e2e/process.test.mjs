import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  spawnOwned,
  stopOwned,
  waitForWebDriver,
  waitOwned,
} from "./process.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-process-test-"));
  const processes = [];
  t.after(async () => {
    for (const owned of processes.reverse()) await stopOwned(owned);
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    track(owned) {
      processes.push(owned);
      return owned;
    },
  };
}

async function waitUntil(condition) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(20);
  }
  assert.fail("owned process did not reach the expected state");
}

test("cancelling an owned process retains its logs and releases its process handle", async (t) => {
  const { root, track } = fixture(t);
  const logPath = join(root, "native.log");
  const owned = track(
    spawnOwned(
      process.execPath,
      ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      { logPath },
    ),
  );
  await waitUntil(() => {
    try {
      return readFileSync(logPath, "utf8").includes("ready");
    } catch {
      return false;
    }
  });
  const cancellation = new AbortController();
  const reason = new Error("cancelled by test");
  const waiting = waitOwned(owned, cancellation.signal);
  cancellation.abort(reason);
  await assert.rejects(waiting, (error) => error === reason);
  await stopOwned(owned);
  assert.equal(owned.state.done, true);
  assert.match(readFileSync(logPath, "utf8"), /ready/);
  await stopOwned(owned);
});

test("failed process startup is reported and cleanup remains safe", async (t) => {
  const { root, track } = fixture(t);
  const owned = track(
    spawnOwned(join(root, "missing-executable"), [], {
      logPath: join(root, "failure.log"),
    }),
  );
  await assert.rejects(waitOwned(owned), { code: "ENOENT" });
  await stopOwned(owned);
  assert.equal(owned.state.done, true);
});

test("an unexpected process exit preserves its code in the owned log", async (t) => {
  const { root, track } = fixture(t);
  const logPath = join(root, "exit.log");
  const owned = track(
    spawnOwned(process.execPath, ["-e", "process.exitCode = 7"], { logPath }),
  );
  await assert.rejects(waitOwned(owned), /受控进程退出（7）/);
  await stopOwned(owned);
  assert.match(
    readFileSync(logPath, "utf8"),
    /\[e2e\] owned-process-exit code=7 signal=null/,
  );
});

test("an unwritable log fails promptly while still stopping the owned process", async (t) => {
  const { root } = fixture(t);
  // 向已有目录写日志会在 Windows / Unix 都失败，子进程本身仍保持运行。
  const owned = spawnOwned(
    process.execPath,
    ["-e", "setInterval(() => process.stdout.write('running'), 50)"],
    { logPath: root },
  );
  try {
    await assert.rejects(
      waitOwned(owned, AbortSignal.timeout(5000)),
      /无法保存受控进程日志/,
    );
    await assert.rejects(
      waitForWebDriver(owned, 1, AbortSignal.timeout(5000)),
      /无法保存受控进程日志/,
    );
    await assert.rejects(stopOwned(owned), /无法保存受控进程日志/);
    assert.equal(owned.state.done, true);
    await assert.rejects(stopOwned(owned), /无法保存受控进程日志/);
  } finally {
    await stopOwned(owned).catch(() => {});
  }
});

test(
  "Unix cleanup stops descendants even after their detached leader has exited",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const { root, track } = fixture(t);
    const pidFile = join(root, "descendant.pid");
    const descendant = `
    require('node:fs').writeFileSync(process.argv[1], String(process.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `;
    const leader = `
    const child = require('node:child_process').spawn(process.execPath,
      ['-e', ${JSON.stringify(descendant)}, process.argv[1]], { stdio: 'ignore' });
    child.unref();
  `;
    const owned = track(
      spawnOwned(process.execPath, ["-e", leader, pidFile], {
        logPath: join(root, "leader.log"),
      }),
    );
    await waitUntil(() => {
      try {
        return Number(readFileSync(pidFile, "utf8")) > 0;
      } catch {
        return false;
      }
    });
    const pid = Number(readFileSync(pidFile, "utf8"));
    await waitOwned(owned);
    assert.equal(owned.state.done, true);
    process.kill(pid, 0);
    await stopOwned(owned);
    await waitUntil(() => {
      try {
        process.kill(pid, 0);
        // 孤儿进程终止后，可能短暂保留为僵尸进程，直至新父进程回收。
        return (
          process.platform === "linux" &&
          readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ")
        );
      } catch (error) {
        if (["ESRCH", "ENOENT"].includes(error.code)) return true;
        throw error;
      }
    });
  },
);

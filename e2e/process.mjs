import { execFile, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** 每个句柄只代表本 runner 直接创建的进程；Unix 使用独立进程组。 */
export function spawnOwned(command, args, { cwd, env, logPath } = {}) {
  const detached = process.platform !== "win32";
  let log;
  if (logPath) {
    mkdirSync(dirname(logPath), { recursive: true });
    log = createWriteStream(logPath, { flags: "w" });
  }
  const state = {
    done: false,
    error: null,
    logError: null,
    cleanupError: null,
  };
  const logFailed = new Promise((done) => {
    log?.on("error", (error) => {
      state.logError = error;
      done(error);
    });
  });
  const child = spawn(command, args, {
    cwd,
    env,
    detached,
    windowsHide: true,
    stdio: log ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  const exited = new Promise((done) => {
    child.once("error", (error) => {
      state.error = error;
    });
    child.once("close", (code, signal) => {
      state.done = true;
      log?.write(
        `\n[${new Date().toISOString()}][e2e] owned-process-exit code=${code ?? "null"} signal=${signal ?? "null"} pid=${child.pid ?? "null"}\n`,
      );
      done({ code, signal, error: state.error });
    });
  });
  return { child, state, exited, log, logPath, logFailed, detached };
}

function assertLog(owned) {
  if (owned.state.logError)
    throw new Error(`无法保存受控进程日志：${owned.logPath}`, {
      cause: owned.state.logError,
    });
}

export async function waitOwned(owned, signal) {
  signal?.throwIfAborted();
  assertLog(owned);
  let onAbort;
  const aborted = new Promise((_, fail) => {
    onAbort = () => fail(signal.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      owned.exited,
      aborted,
      owned.logFailed.then(() => assertLog(owned)),
    ]);
    assertLog(owned);
    if (result.error) throw result.error;
    if (result.code !== 0)
      throw new Error(`受控进程退出（${result.code ?? result.signal}）`);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 停止受控子树；从不按产品名或宽泛进程搜索终止用户实例。 */
export async function stopOwned(owned) {
  if (!owned) return;
  if (owned.stopped) {
    if (owned.state.cleanupError) throw owned.state.cleanupError;
    assertLog(owned);
    return;
  }
  const { child, state, detached } = owned;
  const unixGroup = process.platform !== "win32" && detached && child.pid;
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  // 分离的父进程可能先于子进程退出，仍需清理本次创建的进程组。
  if (unixGroup) signalGroup("SIGTERM");
  if (!state.done && child.pid) {
    if (process.platform === "win32") {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
          });
        } catch (error) {
          state.cleanupError = new Error(
            `受控子树清理失败，无法确认后代进程退出；保留测试数据：${error.message}`,
            { cause: error },
          );
          if (child.exitCode === null && child.signalCode === null) {
            child.kill();
          }
        }
      }
    } else if (!detached) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    const finished = await Promise.race([
      owned.exited.then(() => true),
      delay(5000, undefined, { ref: false }).then(() => false),
    ]);
    if (!finished) {
      if (process.platform !== "win32") {
        try {
          process.kill(detached ? -child.pid : child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      await Promise.race([
        owned.exited,
        delay(2000, undefined, { ref: false }),
      ]);
      if (!state.done)
        throw new Error(`受控进程 ${child.pid} 未退出；保留测试数据以便排查`);
    }
  }
  // 父进程的 close 事件不能证明所有后代进程均已退出。
  if (unixGroup) signalGroup("SIGKILL");
  if (owned.log) {
    const flushed = finished(owned.log);
    if (!owned.log.destroyed && !owned.log.writableEnded) owned.log.end();
    try {
      await flushed;
    } catch (error) {
      owned.state.logError ??= error;
    }
  }
  owned.stopped = true;
  if (state.cleanupError) throw state.cleanupError;
  assertLog(owned);
}

export async function waitForWebDriver(owned, port, signal) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    assertLog(owned);
    if (owned.state.error) throw owned.state.error;
    if (owned.state.done || owned.child.exitCode !== null)
      throw new Error(
        `测试应用在 WebDriver 就绪前退出，请查看 ${owned.logPath}`,
      );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      });
      const body = await response.json();
      if (response.ok && body.value?.ready === true) return;
    } catch {
      signal.throwIfAborted();
    }
    await delay(100, undefined, { signal });
  }
  throw new Error(`内嵌 WebDriver 未在 90 秒内就绪，请查看 ${owned.logPath}`);
}

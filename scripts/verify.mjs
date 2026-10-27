import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnOwned, stopOwned, waitOwned } from "../e2e/process.mjs";

// 测试共用一组，避免 Vitest 与 Node 测试各自的 worker 同时占满机器。
const groups = [
  ["test", "test:scripts"],
  ["format:check", "lint", "typecheck"],
  [
    "config:check",
    "branding:check",
    "docs:previews:check",
    "extension:sdk:check",
    "version:check",
    "extension:demos:check",
  ],
];
const defaultJobs = Math.min(groups.length, availableParallelism());

export function parseVerifyArgs(args) {
  if (args.length === 0) return { jobs: defaultJobs };
  if (args.length === 1 && ["--help", "-h"].includes(args[0]))
    return { help: true };
  const value =
    args.length === 2 && args[0] === "--jobs"
      ? args[1]
      : args.length === 1 && args[0].startsWith("--jobs=")
        ? args[0].slice("--jobs=".length)
        : "";
  if (!/^[1-3]$/.test(value))
    throw new Error("用法：pnpm verify [--jobs <1|2|3>]；--jobs 1 顺序执行。");
  return { jobs: Number(value) };
}

export async function runVerification({ jobs = defaultJobs, runTask, signal }) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > groups.length)
    throw new Error("验证并发组数必须为 1–3。");
  const results = [];
  let next = 0;
  async function check(name) {
    const start = performance.now();
    try {
      await runTask(name, signal);
      results.push({ name, ok: true, durationMs: performance.now() - start });
    } catch (error) {
      results.push({
        name,
        ok: false,
        error,
        durationMs: performance.now() - start,
      });
    }
  }
  async function worker() {
    while (next < groups.length && !signal?.aborted) {
      const group = groups[next++];
      for (const name of group) {
        if (signal?.aborted) return;
        // 独立检查失败后仍收集其他结果，任何失败都会阻止最终构建。
        await check(name);
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  if (!signal?.aborted && results.every((result) => result.ok))
    await check("vite build");
  return {
    results,
    ok: !signal?.aborted && results.every((result) => result.ok),
  };
}

// pnpm 既可能是 Node 脚本，也可能是独立可执行文件；不通过 shell 拼接命令。
export function pnpmCommand(executable, args) {
  return /\.(?:[cm]?js)$/i.test(executable)
    ? [process.execPath, [executable, ...args]]
    : [executable, args];
}

async function main() {
  const options = parseVerifyArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "用法：pnpm verify [--jobs <1|2|3>]\n默认最多并行三组检查；--jobs 1 顺序执行。全部通过后构建桌面前端。",
    );
    return;
  }
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error("请使用 pnpm verify 启动验证。");
  const root = resolve(import.meta.dirname, "..");
  const cache = join(root, ".cache", "verify");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "run-"));
  const controller = new AbortController();
  let exitCode;
  const interrupt = () => {
    exitCode = 130;
    controller.abort(new Error("验证已中断。"));
  };
  const terminate = () => {
    exitCode = 143;
    controller.abort(new Error("验证已终止。"));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  const start = performance.now();
  console.log(`验证：${options.jobs} 组并行；完整日志：${directory}`);
  try {
    const report = await runVerification({
      ...options,
      signal: controller.signal,
      async runTask(name, signal) {
        const logPath = join(directory, `${name.replace(/[: ]/g, "-")}.log`);
        const args =
          name === "vite build" ? ["exec", "vite", "build"] : ["run", name];
        const [command, commandArgs] = pnpmCommand(executable, args);
        console.log(`[${name}] 开始`);
        const owned = spawnOwned(command, commandArgs, { cwd: root, logPath });
        try {
          await waitOwned(owned, signal);
        } finally {
          await stopOwned(owned);
        }
      },
    });
    for (const result of report.results) {
      console.log(
        `[${result.name}] ${result.ok ? "通过" : "失败"} ${(result.durationMs / 1000).toFixed(1)}s`,
      );
      if (!result.ok) {
        console.error(result.error.message);
        const logPath = join(
          directory,
          `${result.name.replace(/[: ]/g, "-")}.log`,
        );
        const log = await readFile(logPath, "utf8").catch(
          (error) => `日志无法读取：${error.message}`,
        );
        console.error(log.split("\n").slice(-45).join("\n"));
      }
    }
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    console.log(
      `验证${report.ok ? "通过" : "未通过"}，总耗时 ${elapsed}s。${report.ok ? "" : `完整日志：${directory}`}`,
    );
    process.exitCode = exitCode ?? (report.ok ? 0 : 1);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

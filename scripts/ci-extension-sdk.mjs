import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const optimizedLevels = new Set(["1", "2", "3", "s", "z"]);
const executableNames = new Set(["extension-tool", "extension-tool.exe"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = () =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();

function optimized(profile) {
  return (
    optimizedLevels.has(profile?.optLevel) && profile.debugAssertions === false
  );
}

export async function prepareSdkTool(
  messagesPath,
  directory,
  {
    sourceSha = source(),
    expectedSource = join(root, "src-tauri/src/bin/extension-tool.rs"),
  } = {},
) {
  if (!/^[a-f0-9]{40}$/i.test(sourceSha))
    throw new Error("Invalid SDK source SHA");
  const messages = (await readFile(messagesPath, "utf8"))
    .split(/\r?\n/)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const artifacts = messages.filter(
    (message) =>
      message?.reason === "compiler-artifact" &&
      message.target?.name === "extension-tool" &&
      message.target.kind?.includes("bin") &&
      typeof message.target.src_path === "string" &&
      resolve(message.target.src_path) === resolve(expectedSource) &&
      typeof message.executable === "string",
  );
  if (artifacts.length !== 1)
    throw new Error("Expected one extension-tool Cargo artifact");
  const artifact = artifacts[0];
  const profile = {
    optLevel: artifact.profile?.opt_level,
    debugAssertions: artifact.profile?.debug_assertions,
  };
  if (!optimized(profile) || artifact.profile.test !== false)
    throw new Error("SDK validation requires an optimized release host tool");
  const executable = basename(artifact.executable);
  if (!executableNames.has(executable))
    throw new Error("Invalid SDK executable name");
  const bytes = await readFile(artifact.executable);
  const receipt = {
    schemaVersion: 1,
    sourceSha,
    executable,
    executableSha256: hash(bytes),
    profile,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, executable), bytes);
  await writeFile(
    join(directory, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

export async function verifySdkTool(directory, sourceSha = source()) {
  const receipt = JSON.parse(
    await readFile(join(directory, "receipt.json"), "utf8"),
  );
  if (
    receipt?.schemaVersion !== 1 ||
    !executableNames.has(receipt.executable) ||
    !/^[a-f0-9]{64}$/.test(receipt.executableSha256 ?? "") ||
    !optimized(receipt.profile)
  )
    throw new Error("Invalid SDK tool receipt");
  if (receipt.sourceSha !== sourceSha)
    throw new Error("SDK tool source does not match this checkout");
  const executable = join(directory, receipt.executable);
  const stat = await lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("SDK tool must be a regular file");
  if (hash(await readFile(executable)) !== receipt.executableSha256)
    throw new Error("SDK tool hash does not match its receipt");
  return { executable, receipt };
}

// 性能验收预算独立于安全超时：当前 worker 总预算 15 秒，冷检查最多使用一半。
export function assertColdHeadroom({ name, elapsedMs, status }) {
  if (status !== 0) throw new Error(`SDK cold check failed: ${name}`);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > 7500)
    throw new Error(
      `SDK cold-start headroom exhausted: ${name} took ${elapsedMs} ms (limit 7500 ms)`,
    );
}

async function runColdSdk(directory, reportPath) {
  const report = {
    sourceSha: source(),
    targetMs: 5000,
    limitMs: 7500,
    samples: [],
  };
  try {
    const { executable, receipt } = await verifySdkTool(
      directory,
      report.sourceSha,
    );
    report.tool = receipt;
    if (process.platform !== "win32") await chmod(executable, 0o755);
    for (const [language, fixture] of [
      ["javascript", "smoke"],
      ["typescript", "smoke"],
      ["typescript", "notebook-smoke"],
    ]) {
      const modulePath = `examples/extensions/dist/${language}.wasm`;
      const moduleSha256 = hash(await readFile(join(root, modulePath)));
      for (let sample = 1; sample <= 3; sample++) {
        const started = performance.now();
        const result = spawnSync(
          process.execPath,
          [
            "scripts/extension-package.mjs",
            "test",
            "--manifest",
            `examples/extensions/${language}/extension.json`,
            "--wasm",
            modulePath,
            "--fixture",
            `examples/extensions/${language}/${fixture}.json`,
          ],
          {
            cwd: root,
            env: {
              ...process.env,
              STARTER_EXTENSION_TOOL: resolve(executable),
            },
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        const timing = {
          name: `${language}/${fixture}`,
          sample,
          moduleSha256,
          elapsedMs: Math.round(performance.now() - started),
          status: result.status,
        };
        report.samples.push(timing);
        if (result.error) throw result.error;
        if (result.status !== 0)
          console.error(result.stderr.trim() || result.stdout.trim());
        assertColdHeadroom(timing);
        const validated = JSON.parse(result.stdout);
        if (validated.validated !== true || validated.smoke === undefined)
          throw new Error("SDK tool did not return a validated fixture result");
        console.log(`${timing.name} cold ${sample}: ${timing.elapsedMs} ms`);
      }
    }
  } catch (error) {
    report.failure = error.message;
    throw error;
  } finally {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [command, first, second] = process.argv.slice(2);
  try {
    if (command === "prepare" && first && second)
      await prepareSdkTool(first, second);
    else if (command === "run" && first && second)
      await runColdSdk(first, second);
    else
      throw new Error(
        "Usage: ci-extension-sdk.mjs prepare <cargo-jsonl> <artifact-dir> | run <artifact-dir> <report.json>",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

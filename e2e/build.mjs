import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildEnvironment } from "../scripts/build-lib.mjs";
import { fileSha256 } from "../scripts/artifact-lib.mjs";

const require = createRequire(import.meta.url);
export const root = resolve(import.meta.dirname, "..");
const targetDirectory = join(root, "src-tauri", "target", "e2e");
const receiptPath = join(targetDirectory, "build.json");

export async function buildE2E() {
  const env = { ...buildEnvironment(), CARGO_TARGET_DIR: targetDirectory };
  const host = execFileSync("rustc", ["-vV"], {
    cwd: root,
    env,
    encoding: "utf8",
  })
    .match(/^host: (.+)$/m)?.[1]
    ?.trim();
  if (!host || !/^[a-zA-Z0-9_-]+$/.test(host))
    throw new Error("无法读取本机 Rust target");
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--no-deps", "--format-version", "1", "--locked"],
      { cwd: join(root, "src-tauri"), env, encoding: "utf8" },
    ),
  );
  const pkg = metadata.packages.find(
    (item) =>
      resolve(item.manifest_path) === join(root, "src-tauri", "Cargo.toml"),
  );
  if (!pkg) throw new Error("未找到应用 Cargo package");
  const binary = pkg.default_run ?? pkg.name;
  const executable = join(
    targetDirectory,
    host,
    "debug",
    `${binary}${process.platform === "win32" ? ".exe" : ""}`,
  );
  await new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("@tauri-apps/cli/tauri.js"),
        "build",
        "--debug",
        "--no-bundle",
        "--target",
        host,
        "--features",
        "e2e",
        "--config",
        "src-tauri/tauri.e2e.conf.json",
      ],
      { cwd: root, env, stdio: "inherit" },
    );
    child.once("error", fail);
    child.once("exit", (code) =>
      code === 0 ? done() : fail(new Error(`E2E 测试构建失败（${code}）`)),
    );
  });
  if (!existsSync(executable))
    throw new Error(`测试主程序不存在：${executable}`);
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(
    receiptPath,
    JSON.stringify(
      {
        executable,
        target: host,
        sha256: fileSha256(executable),
      },
      null,
      2,
    ),
  );
  return executable;
}

export function readE2EBuild() {
  if (!existsSync(receiptPath))
    throw new Error("请先运行 pnpm e2e:build，或直接运行 pnpm test:e2e。");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const expected = join(targetDirectory, receipt.target, "debug");
  if (
    typeof receipt.target !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(receipt.target) ||
    typeof receipt.executable !== "string" ||
    resolve(receipt.executable, "..") !== expected ||
    fileSha256(receipt.executable) !== receipt.sha256
  )
    throw new Error("E2E 构建收据失效，请重新运行 pnpm e2e:build。");
  return receipt.executable;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(`E2E executable: ${await buildE2E()}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

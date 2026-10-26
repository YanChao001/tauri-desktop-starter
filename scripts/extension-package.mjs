import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { open, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildEnvironment } from "./build-lib.mjs";
import { readUiDocuments } from "./extension-ui-resources.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const MODULE_LIMIT = 16 * 1024 * 1024;
const PACKAGE_LIMIT = 24 * 1024 * 1024;
const MANIFEST_LIMIT = 64 * 1024;
const FIXTURE_LIMIT = 1024 * 1024;
const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

async function readBounded(path, limit, label) {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > limit)
      throw new Error(`${label}必须是最多 ${limit} 字节的普通文件`);
    // 保持固定上限，即使文件在 stat 后增长也不先把整个文件装进内存。
    const bytes = Buffer.alloc(limit + 1);
    let total = 0;
    while (total <= limit) {
      const { bytesRead } = await handle.read(
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > limit) throw new Error(`${label}超过 ${limit} 字节`);
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}

function preflight(manifest, wasm) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    typeof manifest.id !== "string" ||
    !Array.isArray(manifest.commands)
  )
    throw new Error("扩展清单需要 id 字符串和 commands 数组");
  if (
    !Buffer.isBuffer(wasm) ||
    wasm.length > MODULE_LIMIT ||
    !wasm.subarray(0, 8).equals(WASM_HEADER)
  )
    throw new Error("需要最多 16 MiB 的 WebAssembly 核心模块");
}

/** 完整规则仅由 Rust 实现：这里通过独立 CLI 复用安装与运行时校验。 */
export function runExtensionTool(command, options) {
  const arguments_ = [
    command,
    "--manifest",
    options.manifestPath,
    "--wasm",
    options.wasmPath,
  ];
  if (options.fixturePath) arguments_.push("--fixture", options.fixturePath);
  if (options.uiPath) arguments_.push("--ui", options.uiPath);
  const executable = process.env.STARTER_EXTENSION_TOOL || "cargo";
  const args = process.env.STARTER_EXTENSION_TOOL
    ? arguments_
    : [
        "run",
        "--quiet",
        "--locked",
        "--manifest-path",
        join(ROOT, "src-tauri/Cargo.toml"),
        "--bin",
        "extension-tool",
        "--",
        ...arguments_,
      ];
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    env: buildEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Rust 扩展校验工具执行失败",
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Rust 扩展校验工具没有返回有效 JSON");
  }
}

async function withValidatedFiles(options, command, runTool, consume) {
  const [manifestBytes, wasm, fixtureBytes] = await Promise.all([
    readBounded(options.manifestPath, MANIFEST_LIMIT, "清单"),
    readBounded(options.wasmPath, MODULE_LIMIT, "Wasm 模块"),
    options.fixturePath
      ? readBounded(options.fixturePath, FIXTURE_LIMIT, "测试 fixture")
      : undefined,
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  preflight(manifest, wasm);
  const uiDocuments = await readUiDocuments(manifest, options.uiDir);
  // 校验与打包使用同一份快照，源文件在 Cargo 构建期间变化也不会绕过校验。
  const temporary = await mkdtemp(join(tmpdir(), "starter-extension-tool-"));
  try {
    const snapshot = {
      manifestPath: join(temporary, "extension.json"),
      wasmPath: join(temporary, "plugin.wasm"),
      ...(fixtureBytes ? { fixturePath: join(temporary, "fixture.json") } : {}),
      ...(Object.keys(uiDocuments).length
        ? { uiPath: join(temporary, "ui.json") }
        : {}),
    };
    await Promise.all([
      writeFile(snapshot.manifestPath, manifestBytes, { mode: 0o600 }),
      writeFile(snapshot.wasmPath, wasm, { mode: 0o600 }),
      fixtureBytes &&
        writeFile(snapshot.fixturePath, fixtureBytes, { mode: 0o600 }),
      snapshot.uiPath &&
        writeFile(snapshot.uiPath, JSON.stringify(uiDocuments), {
          mode: 0o600,
        }),
    ]);
    const report = await runTool(command, snapshot);
    return await consume({ manifest, wasm, uiDocuments, report });
  } finally {
    // temporary 由本函数创建，且从未接受调用方提供的删除目标。
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function validateExtension(
  options,
  { runTool = runExtensionTool } = {},
) {
  return withValidatedFiles(
    options,
    "validate",
    runTool,
    ({ report }) => report,
  );
}

export async function testExtension(
  options,
  { runTool = runExtensionTool } = {},
) {
  if (!options.fixturePath) throw new Error("扩展测试需要 --fixture");
  return withValidatedFiles(options, "test", runTool, ({ report }) => report);
}

export async function packExtension(
  options,
  { runTool = runExtensionTool } = {},
) {
  const { manifestPath, wasmPath, outputPath } = options;
  if (
    resolve(outputPath) === resolve(manifestPath) ||
    resolve(outputPath) === resolve(wasmPath)
  )
    throw new Error("输出不能覆盖清单或 Wasm 模块");
  return withValidatedFiles(
    options,
    "validate",
    runTool,
    async ({ manifest, wasm, uiDocuments, report }) => {
      const content =
        JSON.stringify(
          {
            manifest,
            wasm: wasm.toString("base64"),
            ...(Object.keys(uiDocuments).length ? { uiDocuments } : {}),
          },
          null,
          2,
        ) + "\n";
      if (Buffer.byteLength(content) > PACKAGE_LIMIT)
        throw new Error("扩展包超过 24 MiB");
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(outputPath, content, { flag: "wx" });
      return {
        path: resolve(outputPath),
        sha256: createHash("sha256").update(wasm).digest("hex"),
        validation: report,
      };
    },
  );
}

export function parseArguments(args) {
  const command = args[0];
  if (!["pack", "validate", "test"].includes(command))
    throw new Error(
      "用法：pnpm extension:<pack|validate|test> --manifest <JSON> --wasm <模块> [--out <新包路径> | --fixture <JSON>]",
    );
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = {
      "--manifest": "manifestPath",
      "--wasm": "wasmPath",
      "--ui-dir": "uiDir",
      ...(command === "pack" ? { "--out": "outputPath" } : {}),
      ...(command === "test" ? { "--fixture": "fixturePath" } : {}),
    }[args[index]];
    if (
      !key ||
      !args[index + 1] ||
      args[index + 1].startsWith("--") ||
      options[key]
    )
      throw new Error("参数缺失、重复或不适用于当前命令");
    options[key] = args[index + 1];
  }
  const required = [
    "manifestPath",
    "wasmPath",
    ...(command === "pack" ? ["outputPath"] : []),
    ...(command === "test" ? ["fixturePath"] : []),
  ];
  if (required.some((key) => !options[key])) throw new Error("缺少必需参数");
  return { command, options };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { command, options } = parseArguments(process.argv.slice(2));
    const result = await {
      pack: packExtension,
      validate: validateExtension,
      test: testExtension,
    }[command](options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

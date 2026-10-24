import { createHash } from "node:crypto";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MODULE_LIMIT = 16 * 1024 * 1024;
export function createExtensionPackage(manifest, wasm) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.formatVersion !== 2 ||
    manifest.apiVersion !== 1
  )
    throw new Error("需要格式 2 / API 1 的扩展清单");
  if (
    !Buffer.isBuffer(wasm) ||
    wasm.length > MODULE_LIMIT ||
    !wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  )
    throw new Error("需要最多 16 MiB 的 WebAssembly 核心模块");
  const content =
    JSON.stringify({ manifest, wasm: wasm.toString("base64") }, null, 2) + "\n";
  if (Buffer.byteLength(content) > 24 * 1024 * 1024)
    throw new Error("扩展包超过 24 MiB");
  return { content, sha256: createHash("sha256").update(wasm).digest("hex") };
}
export async function packExtension({ manifestPath, wasmPath, outputPath }) {
  if (
    resolve(outputPath) === resolve(manifestPath) ||
    resolve(outputPath) === resolve(wasmPath)
  )
    throw new Error("输出不能覆盖清单或 Wasm 模块");
  const [metadata, moduleInfo] = await Promise.all([
    stat(manifestPath),
    stat(wasmPath),
  ]);
  if (
    !metadata.isFile() ||
    metadata.size > 16384 ||
    !moduleInfo.isFile() ||
    moduleInfo.size > MODULE_LIMIT
  )
    throw new Error("清单或模块类型、大小无效");
  const [manifest, wasm] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(wasmPath),
  ]);
  const result = createExtensionPackage(JSON.parse(manifest), wasm);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, result.content, { flag: "wx" });
  return { path: resolve(outputPath), sha256: result.sha256 };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2),
      options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = {
        "--manifest": "manifestPath",
        "--wasm": "wasmPath",
        "--out": "outputPath",
      }[args[index]];
      if (
        !key ||
        !args[index + 1] ||
        args[index + 1].startsWith("--") ||
        options[key]
      )
        throw new Error(
          "用法：pnpm extension:pack --manifest <JSON> --wasm <模块> --out <新包路径>",
        );
      options[key] = args[index + 1];
    }
    if (["manifestPath", "wasmPath", "outputPath"].some((key) => !options[key]))
      throw new Error("需要 --manifest、--wasm 和 --out");
    const result = await packExtension(options);
    console.log("已生成 " + result.path + "\nWasm SHA-256: " + result.sha256);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { build } from "esbuild";

const root = import.meta.dirname;
await mkdir(join(root, "dist"), { recursive: true });
for (const [language, suffix] of [
  ["javascript", "js"],
  ["typescript", "ts"],
]) {
  await build({
    absWorkingDir: root,
    entryPoints: [language + "/plugin." + suffix],
    outfile: "dist/" + language + ".js",
    bundle: true,
    format: "cjs",
    target: "es2020",
  });
  const result = spawnSync(
    process.env.EXTISM_JS || "extism-js",
    [
      "dist/" + language + ".js",
      "-i",
      language + "/plugin.d.ts",
      "-o",
      "dist/" + language + ".wasm",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (result.error?.code === "ENOENT") {
    console.error(
      "未找到 Extism JS 编译器。按 docs/extensions.md 安装 extism-js，或用 EXTISM_JS 指定编译器路径。",
    );
    process.exit(1);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

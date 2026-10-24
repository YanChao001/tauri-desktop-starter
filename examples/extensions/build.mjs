import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
for (const [language, suffix] of [
  ["javascript", "js"],
  ["typescript", "ts"],
]) {
  await build({
    entryPoints: [language + "/plugin." + suffix],
    outfile: "dist/" + language + ".js",
    bundle: true,
    format: "cjs",
    target: "es2020",
  });
  execFileSync(
    "extism-js",
    [
      "dist/" + language + ".js",
      "-i",
      language + "/plugin.d.ts",
      "-o",
      "dist/" + language + ".wasm",
    ],
    { stdio: "inherit", windowsHide: true },
  );
}

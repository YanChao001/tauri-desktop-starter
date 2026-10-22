import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseE2EOptions } from "./run-options.mjs";

test("desktop runs require an explicit foreground choice, including reused builds", () => {
  for (const args of [[], ["--skip-build"]])
    assert.throws(() => parseE2EOptions(args), /默认不启动/);
  assert.deepEqual(parseE2EOptions(["--interactive"]), { skipBuild: false });
  assert.deepEqual(parseE2EOptions(["--interactive", "--skip-build"]), {
    skipBuild: true,
  });
  assert.deepEqual(parseE2EOptions(["--skip-build", "--interactive"]), {
    skipBuild: true,
  });
});

test("invalid foreground flags fail without enabling the desktop runner", () => {
  for (const args of [["--interactive=false"], ["--interactive", "--headless"]])
    assert.throws(() => parseE2EOptions(args), /用法/);
});

for (const args of [[], ["--skip-build"]]) {
  test(`the CLI refuses ${args.join(" ") || "a default run"} before build lookup or launch`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./run.mjs", import.meta.url)), ...args],
      {
        // 没有工具链且设置 CI，仍必须先返回前台运行提示，不能开始构建或读取收据。
        env: { ...process.env, PATH: "", Path: "", CI: "1" },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /默认不启动/);
    assert.match(result.stderr, /pnpm test:ui/);
    assert.equal(result.stdout, "");
  });
}

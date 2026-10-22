import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildE2E, readE2EBuild, root } from "./build.mjs";
import { parseE2EOptions } from "./run-options.mjs";
import {
  spawnOwned,
  stopOwned,
  waitForWebDriver,
  waitOwned,
} from "./process.mjs";

const require = createRequire(import.meta.url);
const owned = [];
let dataRoot;
let preserveData = false;
const cancellation = new AbortController();
const interrupt = () => cancellation.abort(new Error("桌面测试已中断"));
try {
  const { skipBuild } = parseE2EOptions(process.argv.slice(2));
  const binary = skipBuild ? readE2EBuild() : await buildE2E();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const temporaryBase = realpathSync(tmpdir());
  dataRoot = mkdtempSync(join(temporaryBase, "starter-e2e-"));
  // 测试部署显式关闭真实更新源，避免启动检查访问生产 GitHub。
  mkdirSync(join(dataRoot, "config"));
  writeFileSync(
    join(dataRoot, "config", "deployment.json"),
    JSON.stringify({
      updates: { endpoint: "", publicKey: "" },
    }),
  );
  for (const phase of ["fresh", "persisted", "centered"]) {
    const port = await new Promise((done, fail) => {
      const socket = createServer();
      socket.once("error", fail);
      socket.listen(0, "127.0.0.1", () => {
        const port = socket.address().port;
        socket.close((error) => (error ? fail(error) : done(port)));
      });
    });
    const env = {
      ...process.env,
      STARTER_TEST_DATA_DIR: dataRoot,
      TAURI_WEBDRIVER_PORT: String(port),
      STARTER_E2E_BINARY: binary,
      STARTER_E2E_DATA_ROOT: dataRoot,
      STARTER_E2E_PHASE: phase,
      STARTER_E2E_PORT: String(port),
    };
    const app = spawnOwned(binary, [], {
      cwd: root,
      env,
      logPath: join(root, "artifacts", "e2e", phase, "native.log"),
    });
    owned.push(app);
    let runner;
    try {
      await waitForWebDriver(app, port, cancellation.signal);
      runner = spawnOwned(
        process.execPath,
        [
          join(
            dirname(dirname(require.resolve("@wdio/cli"))),
            "bin",
            "wdio.js",
          ),
          "run",
          "wdio.conf.mjs",
        ],
        { cwd: root, env },
      );
      owned.push(runner);
      const deadline = AbortSignal.timeout(10 * 60 * 1000);
      await waitOwned(runner, AbortSignal.any([cancellation.signal, deadline]));
    } finally {
      await stopOwned(runner);
      await stopOwned(app);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = cancellation.signal.aborted ? 130 : 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  for (const processHandle of owned.reverse()) {
    try {
      await stopOwned(processHandle);
    } catch (error) {
      preserveData = true;
      console.error(error.message);
      process.exitCode = 1;
    }
  }
  if (dataRoot && !preserveData) {
    const temporaryBase = realpathSync(tmpdir());
    const resolved = resolve(dataRoot);
    if (
      dirname(resolved) !== temporaryBase ||
      !resolved.startsWith(join(temporaryBase, "starter-e2e-"))
    ) {
      console.error("拒绝清理非本次创建的测试目录");
      process.exitCode = 1;
    } else {
      try {
        rmSync(resolved, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 300,
        });
      } catch (error) {
        console.warn(
          `测试数据清理失败，目录保留：${dataRoot}（${error.message}）`,
        );
      }
    }
  }
}

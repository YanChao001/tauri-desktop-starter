#!/usr/bin/env node
/**
 * 便携版打包：产出一个免安装、可直接双击运行的单文件 exe。
 *
 * 为什么不是 `--bundles portable`：Tauri 的 Windows 打包目标只有 msi / nsis，
 * 没有官方 portable 目标。但前端产物在编译期已经嵌进二进制，
 * `tauri build --no-bundle` 得到的 exe 本身就是单文件程序，复制走就能运行。
 *
 * 用法：
 *   pnpm app:portable              # 构建并收集
 *   pnpm app:portable --skip-build # 复用本脚本先前构建的同一 host 产物
 */
import { execFileSync, execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  assertSeparateOutput,
  buildEnvironment,
  portablePaths,
} from "./portable-lib.mjs";
import { checkVersions } from "./version.mjs";
import { removeProjectPath } from "./fs-utils.mjs";

function main() {
  const ROOT = resolve(import.meta.dirname, "..");
  const OUT_DIR = join(ROOT, "dist-portable");
  const SKIP_BUILD = process.argv.includes("--skip-build");

  if (process.argv.slice(2).some((arg) => arg !== "--skip-build")) {
    console.error("用法: pnpm app:portable [--skip-build]");
    process.exit(1);
  }

  if (process.platform !== "win32") {
    console.error("便携包脚本只处理 Windows。");
    console.error(
      "Linux 请直接出 AppImage（本身就是便携格式），macOS 用 .app 拖拽安装。",
    );
    process.exit(1);
  }

  const conf = JSON.parse(
    readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const identifier = conf.identifier;
  const version = checkVersions(ROOT);
  const env = buildEnvironment();
  const target = execFileSync("rustc", ["-vV"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  })
    .match(/^host: (.+)$/m)?.[1]
    ?.trim();
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--no-deps", "--locked", "--format-version", "1"],
      { cwd: join(ROOT, "src-tauri"), env, encoding: "utf8" },
    ),
  );
  const { productName, builtExe, portableExe } = portablePaths(
    ROOT,
    conf,
    metadata,
    target,
  );

  if (!SKIP_BUILD) {
    // --no-bundle：跳过 msi/nsis 打包，只保留编译产物。
    // 顺带的好处是不依赖 WiX / NSIS 工具链，离线也能出包。
    // 显式指定本机 target，覆盖 Cargo 的隐式交叉编译设置，保证收集路径一致。
    execSync(`pnpm tauri build --no-bundle --target ${target}`, {
      cwd: ROOT,
      stdio: "inherit",
      env,
    });
  }

  if (!existsSync(builtExe)) {
    console.error(`找不到编译产物：${builtExe}`);
    console.error("先跑一次 pnpm app:portable（不要加 --skip-build）。");
    process.exit(1);
  }

  assertSeparateOutput(builtExe, OUT_DIR);
  removeProjectPath(ROOT, "dist-portable");
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(builtExe, portableExe);

  const readme = `${productName} 便携版 v${version}
${"=".repeat(40)}

这是免安装版本：满足运行要求后，双击 exe 即可运行，不需要管理员权限。

运行要求
- Windows 10 / 11
- Microsoft Edge WebView2 Runtime
  Win11 自带；较老的 Win10 若缺失，请先手动安装：
  https://go.microsoft.com/fwlink/p/?LinkId=2124703

数据存放位置
- 窗口状态写入 %APPDATA%\\${identifier}
- 日志与 WebView 数据写入 %LOCALAPPDATA%\\${identifier}
  数据不随 exe 移动。如果要求"数据跟着 U 盘走"，把窗口状态与日志路径
  改成 exe 同级目录（注意：放在 Program Files 时该目录不可写）。

分发建议
- 可直接压缩成 zip 分发，解压即用。
- 未签名的 exe 首次运行可能触发 SmartScreen「未知发布者」，属预期行为；
  对外分发请按 docs/build-release.md 配置代码签名。
`;

  writeFileSync(join(OUT_DIR, "使用说明.txt"), readme, "utf8");

  const sizeMb = (statSync(portableExe).size / 1024 / 1024).toFixed(1);
  console.log(
    `\n便携版已生成：dist-portable/${productName}.exe（${sizeMb} MB）`,
  );
  console.log("目录内容：exe + 使用说明.txt，可直接压缩分发。");
  console.log("注意：目标机器需要 WebView2 运行时；数据仍写入 AppData。");
}

try {
  main();
} catch (error) {
  console.error(`便携包生成失败：${error.message}`);
  if (["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
    console.error("请关闭正在运行的便携版，并检查输出目录的写入权限后重试。");
  }
  process.exitCode = 1;
}

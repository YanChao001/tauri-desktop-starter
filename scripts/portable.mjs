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
 *   pnpm app:portable --skip-build # 复用已有 release 产物，只做收集
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "dist-portable");
const SKIP_BUILD = process.argv.includes("--skip-build");

if (process.platform !== "win32") {
  console.error("便携包脚本只处理 Windows。");
  console.error(
    "Linux 请直接出 AppImage（本身就是便携格式），macOS 用 .app 拖拽安装。",
  );
  process.exit(1);
}

function readPackageName() {
  const toml = readFileSync(join(ROOT, "src-tauri/Cargo.toml"), "utf8");
  const start = toml.indexOf("[package]");
  if (start === -1) throw new Error("Cargo.toml 里没有找到 [package]");
  const rest = toml.slice(start + "[package]".length);
  const nextSection = rest.search(/^\[/m);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const match = section.match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Cargo.toml 的 [package] 里没有找到 name");
  return match[1];
}

const conf = JSON.parse(
  readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"),
);
const productName = conf.productName;
const identifier = conf.identifier;
const version = conf.version;
const binaryName = readPackageName();

const builtExe = join(
  ROOT,
  "src-tauri",
  "target",
  "release",
  `${binaryName}.exe`,
);
const portableExe = join(OUT_DIR, `${productName}.exe`);

/**
 * 从 GUI、IDE 任务或 CI 里启动时，PATH 往往没有 rustup 的 ~/.cargo/bin，
 * Tauri CLI 会报 "cargo metadata: program not found"。这里兜底补上。
 */
function buildEnv() {
  const env = { ...process.env };
  const cargoBin = join(homedir(), ".cargo", "bin");
  if (existsSync(join(cargoBin, "cargo.exe"))) {
    env.PATH = `${cargoBin};${env.PATH ?? ""}`;
  }
  return env;
}

if (!SKIP_BUILD) {
  // --no-bundle：跳过 msi/nsis 打包，只保留编译产物。
  // 顺带的好处是不依赖 WiX / NSIS 工具链，离线也能出包。
  execSync("pnpm tauri build --no-bundle", {
    cwd: ROOT,
    stdio: "inherit",
    env: buildEnv(),
  });
}

if (!existsSync(builtExe)) {
  console.error(`找不到编译产物：${builtExe}`);
  console.error("先跑一次 pnpm app:portable（不要加 --skip-build）。");
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(builtExe, portableExe);

const readme = `Tauri Desktop Starter 便携版 v${version}
${"=".repeat(40)}

这是免安装版本：双击 exe 即可运行，不需要管理员权限，也不会写注册表。

运行要求
- Windows 10 / 11
- Microsoft Edge WebView2 Runtime
  Win11 自带；较老的 Win10 若缺失，会提示安装，或手动装：
  https://go.microsoft.com/fwlink/p/?LinkId=2124703

数据存放位置
- 窗口位置、日志等仍写入当前用户的 AppData：
  %LOCALAPPDATA%\\${identifier}
  数据不随 exe 移动。如果要求"数据跟着 U 盘走"，把窗口状态与日志路径
  改成 exe 同级目录（注意：放在 Program Files 时该目录不可写）。

分发建议
- 可直接压缩成 zip 分发，解压即用。
- 未签名的 exe 首次运行可能触发 SmartScreen「未知发布者」，属预期行为；
  对外分发请按 docs/build-release.md 配置代码签名。
`;

writeFileSync(join(OUT_DIR, "使用说明.txt"), readme, "utf8");

const sizeMb = (statSync(portableExe).size / 1024 / 1024).toFixed(1);
console.log(`\n便携版已生成：dist-portable/${productName}.exe（${sizeMb} MB）`);
console.log("目录内容：exe + 使用说明.txt，可直接压缩分发。");
console.log("注意：目标机器需要 WebView2 运行时；数据仍写入 AppData。");

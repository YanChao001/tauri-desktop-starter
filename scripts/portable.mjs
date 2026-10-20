#!/usr/bin/env node
/** 构建便携版，或用有效收据复用先前编译；分发到 artifacts/<版本>/<target>/portable。 */
import { relative, resolve } from "node:path";
import { artifactDirectory, publishArtifacts } from "./artifact-lib.mjs";
import { buildApplication, prepareBuild } from "./build-lib.mjs";
import {
  loadPortableBuild,
  portableFileName,
  recordPortableBuild,
} from "./portable-lib.mjs";

async function main() {
  if (process.platform !== "win32")
    throw new Error(
      "便携包脚本只处理 Windows；Linux 请分发 AppImage，macOS 请分发 .app / DMG。",
    );
  const root = resolve(import.meta.dirname, "..");
  const raw = process.argv.slice(2);
  if (raw.includes("--help") || raw.includes("-h")) {
    console.log(
      "用法: pnpm app:portable [--skip-build] [--target <triple>] [--config <JSON>] [--features <features>] [--ci]",
    );
    return;
  }
  const skipBuild = raw.includes("--skip-build");
  const args = raw.filter((arg) => arg !== "--skip-build");
  if (args.some((arg) => /^(?:--bundles|-b)(?:=|$)/.test(arg)))
    throw new Error("便携版不生成安装器；--bundles 请使用 pnpm app:build。");
  const plan = prepareBuild(root, [...args, "--no-bundle"]);
  if (plan.platform !== "windows")
    throw new Error("便携版只支持 Windows 编译目标");
  const productName = plan.config.productName ?? plan.package.name;
  const executableName = portableFileName(productName);
  artifactDirectory(root, plan.version, plan.target, "portable");
  const built = skipBuild
    ? loadPortableBuild(plan)
    : await buildApplication(plan);
  if (!built.target.includes("-windows-"))
    throw new Error("便携构建记录不属于 Windows 目标平台");
  if (!skipBuild) recordPortableBuild(plan, built);
  const readme = `${productName} 便携版 v${plan.version}

双击 EXE 运行。目标机器需要 Windows 10 / 11 与 Microsoft Edge WebView2 Runtime。
缺少运行时时请先安装：https://go.microsoft.com/fwlink/p/?LinkId=2124703

偏好、窗口状态与 SQLite 笔记写入 %APPDATA%\\${plan.config.identifier}，日志与 WebView 数据写入 %LOCALAPPDATA%\\${plan.config.identifier}。
数据不随 EXE 移动。本程序无需安装，但不是将全部用户数据保存在同目录的绿色版。
笔记须点击“保存”后才会持久化；退出前请先保存编辑内容。自启动和后台运行默认关闭，可在“桌面集成”中开启。
配置更新签名后，应用内安装更新会启动 NSIS 安装器，转为安装版，不会原地替换便携 EXE；若需保持免安装形态，请手动下载新版便携包。

此脚本不会进行 Authenticode 签名。对外分发前需单独配置签名并验证运行环境。
manifest.json 记录版本、目标平台和文件 SHA-256，可用于检查分发文件完整性。
`;
  const output = publishArtifacts(root, {
    version: plan.version,
    target: built.target,
    kind: "portable",
    entries: [
      { source: built.executable, path: executableName },
      { contents: readme, path: "使用说明.txt" },
    ],
  });
  console.log(`便携版已生成：${relative(root, output)}`);
}

try {
  await main();
} catch (error) {
  console.error(`便携包生成失败：${error.message}`);
  if (["EPERM", "EBUSY", "EACCES"].includes(error.code))
    console.error("请关闭占用发布文件的程序，并检查目录写入权限后重试。");
  process.exitCode = 1;
}

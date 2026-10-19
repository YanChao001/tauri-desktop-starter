#!/usr/bin/env node
import { resolve } from "node:path";
import { publishArtifacts } from "./artifact-lib.mjs";
import {
  buildApplication,
  bundleApplication,
  prepareBuild,
} from "./build-lib.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(`用法: pnpm app:build [--target <triple>] [--bundles nsis,msi] [--config <JSON>] [--features <features>]
支持 release 构建，以及 --ci、--no-sign、--skip-stapling、--no-binary-patching、-v / --verbose。
--no-bundle 仅编译主程序，不归档安装包。其他高级参数请使用 pnpm tauri build。`);
} else {
  try {
    const root = resolve(import.meta.dirname, "..");
    const plan = prepareBuild(root, args);
    const built = await buildApplication(plan);
    if (plan.noBundle) {
      console.log(`\n主程序已构建：${built.executable}`);
    } else {
      const outputDir = await bundleApplication(plan, built, (entries) =>
        publishArtifacts(root, {
          version: plan.version,
          target: built.target,
          kind: "installers",
          entries,
        }),
      );
      console.log(`\n安装包已归档：${outputDir}`);
    }
  } catch (error) {
    console.error(
      `应用构建失败${error.code ? ` [${error.code}]` : ""}：${error.message}`,
    );
    if (["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
      console.error(
        "请关闭占用分发目录的安装器、预览窗口或位于该目录的终端，检查写入权限后重试。",
      );
    }
    process.exitCode = error.exitCode ?? 1;
  }
}

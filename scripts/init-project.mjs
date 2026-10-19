import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyInitialization,
  initializationDiff,
  prepareInitialization,
} from "./init-lib.mjs";

try {
  const args = process.argv.slice(2);
  let config,
    dryRun = false,
    minimal = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--dry-run") dryRun = true;
    else if (args[index] === "--minimal") minimal = true;
    else if (
      args[index] === "--config" &&
      !config &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    )
      config = args[++index];
    else if (["--help", "-h"].includes(args[index])) {
      console.log(
        "用法: pnpm init:project [--config <品牌JSON文件>] [--minimal] [--dry-run]\n默认保留演示；--minimal 设置精简模式。版本请用 pnpm version:set，图标请用 pnpm tauri icon 单独生成。签名私钥不会被读取或修改。",
      );
      process.exit(0);
    } else throw new Error(`未知或缺值参数：${args[index]}`);
  }
  const root = resolve(import.meta.dirname, "..");
  const patch = config ? JSON.parse(readFileSync(resolve(config), "utf8")) : {};
  const plan = prepareInitialization(root, patch, { minimal });
  console.log(initializationDiff(plan) || "应用配置已一致，无需修改。");
  if (dryRun) console.log(`预览完成：${plan.changes.length} 个文件，未写入。`);
  else {
    applyInitialization(plan);
    console.log(
      `初始化完成：${plan.changes.length} 个文件；模式 ${plan.config.defaultMode}。请检查品牌图标、安装器位图和更新签名公钥，再运行 pnpm verify。`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

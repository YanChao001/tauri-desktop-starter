import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyInitialization,
  checkInitialization,
  initializationDiff,
  prepareInitialization,
} from "./init-lib.mjs";

try {
  const args = process.argv.slice(2);
  let config,
    dryRun = false,
    check = false,
    minimal = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--dry-run") dryRun = true;
    else if (args[index] === "--check") check = true;
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
        "用法: pnpm init:project [--config <品牌JSON文件>] [--minimal] [--dry-run]\n检查同步: pnpm config:check\n默认保留演示；--minimal 设置精简模式。版本请用 pnpm version:set；图标和安装器主视觉修改 resources/branding/*.svg 后运行 pnpm branding:generate。签名私钥不会被读取或修改。",
      );
      process.exit(0);
    } else throw new Error(`未知或缺值参数：${args[index]}`);
  }
  if (check && (config || minimal || dryRun))
    throw new Error(
      "--check 仅检查当前配置，不能与 --config、--minimal 或 --dry-run 合用",
    );
  const root = resolve(import.meta.dirname, "..");
  const patch = config ? JSON.parse(readFileSync(resolve(config), "utf8")) : {};
  if (check) {
    const differences = checkInitialization(root);
    if (differences.length)
      throw new Error(
        `应用配置未同步：${differences.join("、")}。请运行 pnpm init:project --dry-run 核对，再运行 pnpm init:project。`,
      );
    console.log("应用身份、系统集成与品牌配置一致。");
    process.exit(0);
  }
  const plan = prepareInitialization(root, patch, { minimal });
  console.log(initializationDiff(plan) || "应用配置已一致，无需修改。");
  if (dryRun) console.log(`预览完成：${plan.changes.length} 个文件，未写入。`);
  else {
    applyInitialization(plan);
    console.log(
      `初始化完成：${plan.changes.length} 个文件；模式 ${plan.config.defaultMode}。请核对 LICENSE、安全联系人、代码签名策略与门户、仓库 About/Pages 和品牌 SVG；为自己的更新源配置公钥，再运行 pnpm verify。`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

import { relative } from "node:path";
import {
  BRANDING_ROOT,
  brandingDifferences,
  planBranding,
  writeBranding,
} from "./branding-lib.mjs";

try {
  const args = process.argv.slice(2);
  if (
    args.some((argument) => !["--check", "--help", "-h"].includes(argument))
  ) {
    throw new Error("用法: pnpm branding:generate 或 pnpm branding:check");
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "从 resources/branding/*.svg 派生平台图标和安装器 BMP。--check 只检查，不写文件。",
    );
  } else {
    const plan = planBranding();
    const changed = brandingDifferences(plan);
    if (args.includes("--check") && changed.length) {
      throw new Error(
        `品牌资源与 SVG 源不一致，请运行 pnpm branding:generate:\n${changed.map(({ path }) => `  ${relative(BRANDING_ROOT, path)}`).join("\n")}`,
      );
    }
    if (!args.includes("--check")) writeBranding(changed);
    console.log(
      `品牌资源${args.includes("--check") ? "检查通过" : "已生成"}：${plan.length} 个文件，${changed.length} 个差异，${plan.reduce((total, { contents }) => total + contents.length, 0)} 字节。`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

import { fileURLToPath } from "node:url";
import { diagnose } from "./doctor-lib.mjs";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--json", "--help", "-h"].includes(arg)))
    throw new Error("用法: node scripts/doctor.mjs [--json]");
  if (args.includes("--help") || args.includes("-h"))
    console.log(
      "用法: node scripts/doctor.mjs [--json]\n只读取环境，不安装工具；缺少必要组件时退出码为 1。",
    );
  else {
    const report = diagnose(fileURLToPath(new URL("..", import.meta.url)));
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else
      for (const item of report.checks)
        console.log(
          `[${item.status.toUpperCase()}] ${item.name}: ${item.detail}${item.remedy ? `\n  → ${item.remedy}` : ""}`,
        );
    if (!report.ok) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

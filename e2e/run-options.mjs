/** 原生窗口测试会主动激活窗口，必须在启动构建或进程前明确选择前台运行。 */
export function parseE2EOptions(args) {
  if (args.some((arg) => !["--interactive", "--skip-build"].includes(arg)))
    throw new Error("用法: pnpm test:e2e --interactive [--skip-build]");
  if (!args.includes("--interactive"))
    throw new Error(
      "真实桌面 E2E 会显示、激活和切换窗口，可能打断当前输入；默认不启动。\n" +
        "日常界面检查请运行 pnpm test:ui。需要前台验收时，显式运行 pnpm test:e2e --interactive。",
    );
  return { skipBuild: args.includes("--skip-build") };
}

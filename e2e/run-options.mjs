/** 原生窗口测试会主动激活窗口，必须在启动构建或进程前明确选择前台运行。 */
export function parseE2EOptions(args, platform = process.platform) {
  if (
    args.some(
      (arg) => !["--interactive", "--skip-build", "--previews"].includes(arg),
    )
  )
    throw new Error(
      "用法: pnpm test:e2e --interactive [--skip-build]；截图使用 pnpm docs:capture --interactive。",
    );
  if (!args.includes("--interactive"))
    throw new Error(
      "真实桌面 E2E 会显示、激活和切换窗口，可能打断当前输入；默认不启动。\n" +
        "日常界面检查请运行 pnpm test:ui。需要前台验收时，显式运行 pnpm test:e2e --interactive。",
    );
  const previews = args.includes("--previews");
  if (previews && platform !== "win32")
    throw new Error(
      "README 原生截图使用 Windows，请在 Windows 上运行 pnpm docs:capture --interactive。",
    );
  return {
    skipBuild: args.includes("--skip-build"),
    phases: previews ? ["previews"] : ["fresh", "persisted", "centered"],
  };
}

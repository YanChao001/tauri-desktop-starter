/**
 * 系统能力的唯一出口。
 *
 * 这个文件是 `lib/` 里唯一允许 import `@tauri-apps/*` 的地方
 * （ESLint 的 no-restricted-imports 会强制这一点）。
 * 页面、组件、hooks 只调用这里导出的函数，不直接碰 Tauri API。
 */

/** 判断当前是否运行在 Tauri 窗口里（而非普通浏览器预览）。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 用系统默认浏览器打开外链；在浏览器预览时退化为新标签页。 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    // 弹窗被浏览器拦截时 window.open 返回 null，不能静默失败
    if (!window.open(url, "_blank", "noopener,noreferrer")) {
      throw new Error("浏览器阻止了弹出窗口，请手动复制链接");
    }
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** 显示并聚焦主窗口。窗口初始为隐藏，见 tauri.conf.json。 */
export async function revealWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window_ = getCurrentWindow();
    await window_.show();
    await window_.setFocus();
  } catch (error) {
    // 这里不抛：窗口没能显示时 Rust 侧的 3 秒兜底仍会生效
    console.error("显示窗口失败", error);
  }
}

/**
 * 调用 Rust 侧的 greet 命令。
 *
 * 空名称由 Rust 侧返回 Err，前端拿到的就是一个 reject——
 * 这是模板刻意示范的错误链路：校验放在边界，错误由调用方展示。
 */
export async function invokeGreet(name: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("浏览器预览模式下无法调用，请用 pnpm app:dev 启动");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("greet", { name });
}

export type AppInfo = {
  /** 应用版本，来源是 tauri.conf.json */
  version: string;
  /** Tauri 运行时版本 */
  tauriVersion: string;
};

/** 读取应用与运行时版本，浏览器预览下不可用。 */
export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    throw new Error("浏览器预览模式下无法读取运行时信息");
  }
  const app = await import("@tauri-apps/api/app");
  const [version, tauriVersion] = await Promise.all([
    app.getVersion(),
    app.getTauriVersion(),
  ]);
  return { version, tauriVersion };
}

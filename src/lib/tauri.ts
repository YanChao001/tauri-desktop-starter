import { useEffect } from "react";

/** 判断当前是否运行在 Tauri 窗口里（而非普通浏览器预览）。 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 用系统默认浏览器打开外链；在浏览器预览时退化为新标签页。 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/**
 * 拦截页面上所有 http(s) 链接，交给系统浏览器打开。
 * 桌面应用里直接在 WebView 中跳转外部站点是最常见的体验事故。
 */
export function useExternalLinks(): void {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.(
        "a[href^='http']",
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      event.preventDefault();
      void openExternal(anchor.href);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
}

/**
 * 窗口默认是隐藏的（避免启动白屏），首帧渲染完成后由前端主动显示。
 * Rust 侧另有 3 秒兜底，防止前端异常导致窗口永不出现。
 */
export function useRevealWindow(): void {
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      } catch (error) {
        console.error("显示窗口失败", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

/** 示例：调用 Rust 侧的 greet 命令。 */
export async function invokeGreet(name: string): Promise<string> {
  if (!isTauri) {
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
  if (!isTauri) {
    throw new Error("浏览器预览模式下无法读取运行时信息");
  }
  const app = await import("@tauri-apps/api/app");
  const [version, tauriVersion] = await Promise.all([
    app.getVersion(),
    app.getTauriVersion(),
  ]);
  return { version, tauriVersion };
}

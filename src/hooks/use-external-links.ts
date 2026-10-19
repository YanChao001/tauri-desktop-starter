import { useEffect } from "react";
import { openExternal } from "@/lib/tauri";

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

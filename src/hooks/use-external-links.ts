import { useEffect } from "react";
import { toast } from "sonner";
import { openExternal } from "@/lib/tauri";

/**
 * 拦截页面上所有 http(s) 链接，交给系统浏览器打开。
 * 桌面应用里直接在 WebView 中跳转外部站点是最常见的体验事故。
 */
export function useExternalLinks(): void {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      // 已被其他处理器处理过的点击不再抢
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.(
        "a[href^='http']",
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      event.preventDefault();
      openExternal(anchor.href).catch((error: unknown) => {
        // 权限被拒、没有默认浏览器等情况：给出可操作的提示，而不是静默失败
        console.error("打开外链失败", error);
        toast.error("无法用系统浏览器打开链接，请手动复制地址");
      });
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
}

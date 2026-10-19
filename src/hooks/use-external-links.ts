import { useEffect } from "react";
import { toast } from "sonner";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { openExternal } from "@/lib/tauri";

/**
 * 拦截页面上所有 http(s) 链接，交给系统浏览器打开。
 * 桌面应用里直接在 WebView 中跳转外部站点是最常见的体验事故。
 */
export function useExternalLinks(): void {
  const t = useLatestTranslator();
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      // 已被其他处理器处理过的点击不再抢
      if (event.defaultPrevented) return;
      if (event.type === "auxclick" && event.button !== 1) return;
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      // 读取原始地址以保留站内相对链接与 hash 路由，同时覆盖大小写和协议相对外链
      const href = anchor.getAttribute("href")?.trim() ?? "";
      if (!/^(https?:|\/\/)/i.test(href)) return;
      if (anchor.protocol !== "https:" && anchor.protocol !== "http:") return;
      event.preventDefault();
      openExternal(anchor.href).catch((error: unknown) => {
        // 权限被拒、没有默认浏览器等情况：给出可操作的提示，而不是静默失败
        console.error("打开外链失败", error);
        toast.error(t("common.openFailed"));
      });
    };

    document.addEventListener("click", handler);
    document.addEventListener("auxclick", handler);
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("auxclick", handler);
    };
  }, [t]);
}

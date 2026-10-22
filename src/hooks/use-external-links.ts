import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { isTauri, openExternal } from "@/lib/tauri";

/** 组件主动打开外链与全局兜底共用错误反馈和最新语言。 */
export function useOpenExternal(): (url: string) => void {
  const t = useLatestTranslator();
  return useCallback(
    (url: string) => {
      void openExternal(url).catch((error: unknown) => {
        console.error("打开外链失败", error);
        toast.error(t("common.openFailed"));
      });
    },
    [t],
  );
}

/**
 * 为未使用 ExternalLink 的 http(s) 链接提供原生打开兜底。
 * 组件已处理的点击不会重复打开，外部页面不进入当前可信 WebView。
 */
export function useExternalLinks(): void {
  const open = useOpenExternal();
  useEffect(() => {
    // 普通浏览器保留链接目标、修饰键和中键的原生导航语义。
    if (!isTauri()) return;
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
      open(anchor.href);
    };

    document.addEventListener("click", handler);
    document.addEventListener("auxclick", handler);
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("auxclick", handler);
    };
  }, [open]);
}

import { useLayoutEffect, useRef } from "react";

/** 主窗口与扩展窗口按标题栏的实际高度为内容留出空间。 */
export function useAppChrome() {
  const chrome = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = chrome.current!;
    const root = document.documentElement;
    const syncHeight = () =>
      root.style.setProperty(
        "--app-chrome-height",
        `${header.getBoundingClientRect().height}px`,
      );
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-chrome-height");
    };
  }, []);
  return chrome;
}

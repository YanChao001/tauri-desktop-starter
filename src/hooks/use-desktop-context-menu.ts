import { useEffect } from "react";
import { isTauri } from "@/lib/tauri";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
]);

function isContentEditable(element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const value = current.getAttribute("contenteditable")?.toLowerCase();
    if (value === "false") return false;
    if (value === "" || value === "true" || value === "plaintext-only")
      return true;
  }
  return false;
}

function hasTextSelection(target: Node): boolean {
  const selection = window.getSelection();
  return !!(
    selection &&
    !selection.isCollapsed &&
    selection.toString().length > 0 &&
    Array.from({ length: selection.rangeCount }, (_, index) =>
      selection.getRangeAt(index),
    ).some((range) => range.intersectsNode(target))
  );
}

/** 桌面普通区域不显示浏览器菜单；编辑与选区交给 WebView 保留原生编辑语义。 */
export function useDesktopContextMenu() {
  useEffect(() => {
    if (!isTauri()) return;
    const handleContextMenu = (event: MouseEvent) => {
      // 在 document 冒泡阶段执行，让业务 ContextMenu 和 portal 先处理事件。
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const element = target instanceof Element ? target : target.parentElement;
      const control = element?.closest("input, textarea");
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement
      ) {
        if (
          !control.matches(":disabled") &&
          (control instanceof HTMLTextAreaElement ||
            TEXT_INPUT_TYPES.has(control.type))
        )
          return;
      } else if (
        (element && isContentEditable(element)) ||
        hasTextSelection(target)
      ) {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);
}

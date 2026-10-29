import { isTauri, writeSystemClipboard } from "./tauri";

/**
 * 剪贴板写入。
 *
 * 桌面复用官方插件；浏览器优先异步 Clipboard API，权限不可用时保留
 * textarea 回退，并恢复用户原来的焦点与选择。
 */
export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    await writeSystemClipboard(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 组合下 API 存在但调用会抛（安全上下文判定差异），
      // 不能在这里把错误抛给调用方，落到下面的降级路径
    }
  }

  const activeElement = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const input =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
      ? activeElement
      : null;
  const inputSelection = input && {
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection,
  };
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (!document.execCommand("copy")) {
      throw Object.assign(new Error("Clipboard write failed"), {
        code: "CLIPBOARD_WRITE_FAILED",
      });
    }
  } finally {
    textarea.remove();
    if (activeElement instanceof HTMLElement && activeElement.isConnected) {
      activeElement.focus({ preventScroll: true });
      if (inputSelection?.start != null && inputSelection.end != null) {
        input?.setSelectionRange(
          inputSelection.start,
          inputSelection.end,
          inputSelection.direction ?? undefined,
        );
      }
    }
    if (selection && ranges.length > 0) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

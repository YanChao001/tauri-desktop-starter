/**
 * 剪贴板写入。
 *
 * 优先用异步 Clipboard API。它要求安全上下文，在部分 WebView 组合下会
 * 直接不可用或抛错，因此保留 textarea 回退。
 * 如果目标平台仍然不稳，换成 tauri-plugin-clipboard-manager 即可，
 * 调用方不需要改。
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 组合下 API 存在但调用会抛（安全上下文判定差异），
      // 不能在这里把错误抛给调用方，落到下面的降级路径
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("当前环境不支持复制");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

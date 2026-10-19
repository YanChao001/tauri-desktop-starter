import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openExternal } from "@/lib/tauri";
import { useExternalLinks } from "./use-external-links";

vi.mock("@/lib/tauri", () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function getAnchor(): HTMLAnchorElement {
  const anchor = document.querySelector("a");
  if (!anchor) throw new Error("测试锚点未创建");
  return anchor;
}

describe("useExternalLinks", () => {
  beforeEach(() => {
    vi.mocked(openExternal).mockClear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    // vitest 未开 globals，Testing Library 不会自动 cleanup，必须显式卸载
    cleanup();
    document.body.innerHTML = "";
  });

  it("把 http(s) 链接交给系统浏览器，并阻止 WebView 内跳转", () => {
    renderHook(() => useExternalLinks());
    document.body.innerHTML = '<a href="https://example.com/docs">文档</a>';

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    getAnchor().dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("站内锚点等其他链接不拦截", () => {
    renderHook(() => useExternalLinks());
    document.body.innerHTML = '<a href="#section">锚点</a>';

    // 这个监听器排在钩子之后：先记录钩子有没有 preventDefault，再阻止 jsdom
    // 真的去跟随链接（否则会刷一条 not implemented 噪音）
    let preventedByHook = true;
    document.addEventListener(
      "click",
      (event) => {
        preventedByHook = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );

    getAnchor().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(preventedByHook).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("卸载后不再响应点击", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    unmount();
    document.body.innerHTML = '<a href="https://example.com">文档</a>';

    getAnchor().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(openExternal).not.toHaveBeenCalled();
  });
});

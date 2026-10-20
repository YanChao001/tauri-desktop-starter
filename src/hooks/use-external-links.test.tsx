import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { isTauri, openExternal } from "@/lib/tauri";
import { useExternalLinks } from "./use-external-links";

const language = vi.hoisted(() => ({ value: "" }));

vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => true),
  openExternal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => {
    const current = language.value;
    return { t: (key: string) => (current ? `${current}:${key}` : key) };
  },
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
    vi.mocked(isTauri).mockReturnValue(true);
    language.value = "";
    vi.mocked(openExternal).mockReset().mockResolvedValue(undefined);
    vi.mocked(toast.error).mockClear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    // Vitest 未启用全局函数，Testing Library 不会自动清理，需显式卸载
    cleanup();
    vi.restoreAllMocks();
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

  it("浏览器演示保留普通链接行为，不调用原生外链门面", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    renderHook(() => useExternalLinks());
    document.body.innerHTML =
      '<a href="https://example.com" target="_blank" rel="noopener">源码</a>';
    let prevented = true;
    getAnchor().addEventListener("click", (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    });
    getAnchor().dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    );
    expect(prevented).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it.each([
    "HTTPS://example.com/docs",
    "  https://example.com/docs",
    "//example.com/docs",
  ])("覆盖大小写、空白与协议相对地址：%s", (href) => {
    renderHook(() => useExternalLinks());
    document.body.innerHTML = `<a href="${href}"><span>文档</span></a>`;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    getAnchor().firstElementChild?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(getAnchor().href);
  });

  it("鼠标中键打开外链也交给系统浏览器", () => {
    renderHook(() => useExternalLinks());
    document.body.innerHTML = '<a href="https://example.com/docs">文档</a>';
    const click = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    getAnchor().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(getAnchor().href);
  });

  it("站内锚点等其他链接不拦截", () => {
    renderHook(() => useExternalLinks());
    document.body.innerHTML = '<a href="#section">锚点</a>';

    // 此监听器在钩子之后执行，先记录钩子是否阻止默认行为
    // 再阻止 jsdom 跳转，避免未实现导航产生无关错误
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
    getAnchor().addEventListener("click", (event) => event.preventDefault());

    getAnchor().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(openExternal).not.toHaveBeenCalled();
  });

  it("打开失败时使用当前语言的错误提示", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("denied"));
    renderHook(() => useExternalLinks());
    document.body.innerHTML = '<a href="https://example.com">文档</a>';
    getAnchor().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith("common.openFailed");
  });

  it("外链请求等待期间切换语言，失败通知使用完成时的语言", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectOpen!: (error: Error) => void;
    vi.mocked(openExternal).mockImplementationOnce(
      () => new Promise((_, reject) => (rejectOpen = reject)),
    );
    language.value = "zh";
    const { rerender } = renderHook(() => useExternalLinks());
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a href="https://example.com">文档</a>',
    );
    getAnchor().dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    language.value = "en";
    rerender();
    await act(async () => rejectOpen(new Error("denied")));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("en:common.openFailed");
  });
});

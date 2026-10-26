import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_REVEAL_EVENT, useThemeSwitch } from "./use-theme-switch";

const { setTheme, update, motion } = vi.hoisted(() => ({
  setTheme: vi.fn(),
  update: vi.fn(),
  motion: { value: "full", theme: "light", resolved: "light" },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: motion.theme,
    resolvedTheme: motion.resolved,
    setTheme,
  }),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({
    settings: { motion: motion.value, theme: motion.theme },
    update,
  }),
}));

describe("useThemeSwitch", () => {
  beforeEach(() => {
    motion.value = "full";
    motion.theme = "light";
    motion.resolved = "light";
    setTheme.mockClear();
    update.mockClear();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "startViewTransition");
    Reflect.deleteProperty(document.documentElement, "animate");
  });

  function mockTransition(ready: Promise<void> = Promise.resolve()) {
    const animate = vi.fn();
    const start = vi.fn((callback: () => void) => {
      callback();
      return { ready };
    });
    Object.defineProperty(document, "startViewTransition", {
      value: start,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "animate", {
      value: animate,
      configurable: true,
    });
    return { start, animate };
  }

  it("开启系统减少动态效果时直接切换，跳过 JS 动画", () => {
    const { start, animate } = mockTransition();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const { result } = renderHook(() => useThemeSwitch());
    act(() => result.current.toggle({ clientX: 10, clientY: 20 }));
    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(start).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it("动画被跳过时处理 ready 拒绝，主题仍切换成功", async () => {
    const { animate } = mockTransition(
      Promise.reject(new DOMException("skipped", "AbortError")),
    );
    const { result } = renderHook(() => useThemeSwitch());
    await act(async () => result.current.toggle({ clientX: 10, clientY: 20 }));
    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(animate).not.toHaveBeenCalled();
  });
  it("prepares opaque children before changing the theme using the same circular reveal", async () => {
    const { animate } = mockTransition();
    const order: string[] = [];
    const listener = vi.fn((event: Event) => {
      order.push("prepare");
      expect((event as CustomEvent).detail).toMatchObject({
        clientX: 10,
        clientY: 20,
        duration: 520,
        easing: "ease-in-out",
      });
    });
    window.addEventListener(THEME_REVEAL_EVENT, listener);
    setTheme.mockImplementationOnce(() => {
      order.push("apply");
    });
    try {
      const { result } = renderHook(() => useThemeSwitch());
      await act(async () =>
        result.current.toggle({ clientX: 10, clientY: 20 }),
      );
      expect(order).toEqual(["prepare", "apply"]);
      expect(animate).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(THEME_REVEAL_EVENT, listener);
    }
  });

  it("没有 View Transitions 时仍能切换主题", () => {
    const { result } = renderHook(() => useThemeSwitch());
    act(() => result.current.toggle({ clientX: 10, clientY: 20 }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("用户关闭动效时跳过 View Transition", () => {
    const { start } = mockTransition();
    motion.value = "reduced";
    const { result } = renderHook(() => useThemeSwitch());
    act(() => result.current.toggle({ clientX: 10, clientY: 20 }));
    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(start).not.toHaveBeenCalled();
  });

  it("persists supported theme choices and ignores invalid runtime values", () => {
    motion.theme = "system";
    const { result } = renderHook(() => useThemeSwitch());
    expect(result.current.theme).toBe("system");
    act(() => result.current.setTheme("dark"));
    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: "dark" });
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
    act(() => result.current.setTheme("unknown"));
    expect(update).toHaveBeenCalledOnce();
    expect(setTheme).toHaveBeenCalledOnce();
  });

  it("toggles from the resolved system appearance and persists the result", () => {
    motion.theme = "system";
    motion.resolved = "dark";
    const { result } = renderHook(() => useThemeSwitch());
    act(() => result.current.toggle({ clientX: 10, clientY: 20 }));
    expect(update).toHaveBeenCalledWith({ theme: "light" });
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});

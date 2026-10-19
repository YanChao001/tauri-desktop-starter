import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeSwitch } from "./use-theme-switch";

const { setTheme, motion } = vi.hoisted(() => ({
  setTheme: vi.fn(),
  motion: { value: "full" },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme }),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { motion: motion.value } }),
}));

describe("useThemeSwitch", () => {
  beforeEach(() => {
    motion.value = "full";
    setTheme.mockClear();
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
});

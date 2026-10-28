import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_REVEAL_EVENT,
  useSynchronizedTheme,
  useThemeSwitch,
} from "./use-theme-switch";
import { STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/settings-model";

const { setTheme, update, motion } = vi.hoisted(() => ({
  setTheme: vi.fn(),
  update: vi.fn(),
  motion: {
    value: "full",
    theme: "light",
    resolved: "light",
    savedTheme: null as string | null,
    persistence: "saved",
    native: false,
  },
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
    settings: {
      motion: motion.value,
      theme: motion.savedTheme ?? motion.theme,
    },
    persistence: motion.persistence,
    update,
  }),
}));
vi.mock("@/lib/tauri", () => ({ isTauri: () => motion.native }));

describe("useThemeSwitch", () => {
  beforeEach(() => {
    motion.value = "full";
    motion.theme = "light";
    motion.resolved = "light";
    motion.savedTheme = null;
    motion.persistence = "saved";
    motion.native = false;
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

  function deferredTransition() {
    const animate = vi.fn();
    const skip = vi.fn();
    const start = vi.fn((callback: () => void) => ({
      ready: Promise.resolve().then(callback),
      skipTransition: skip,
    }));
    Object.defineProperty(document, "startViewTransition", {
      value: start,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "animate", {
      value: animate,
      configurable: true,
    });
    return { start, animate, skip };
  }

  it("animates an accepted remote theme around this window's theme button without writing settings back", async () => {
    motion.native = true;
    const { start, animate } = deferredTransition();
    const button = document.createElement("button");
    button.dataset.themeControl = "";
    document.body.append(button);
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 740,
      top: 0,
      width: 40,
      height: 40,
    } as DOMRect);
    const prepare = vi.fn();
    window.addEventListener(THEME_REVEAL_EVENT, prepare);
    try {
      const { rerender } = renderHook(useSynchronizedTheme);
      expect(start).not.toHaveBeenCalled();
      motion.savedTheme = "dark";
      rerender();
      expect(prepare).toHaveBeenCalledOnce();
      expect(
        (prepare.mock.calls.at(0)?.[0] as CustomEvent).detail,
      ).toMatchObject({
        clientX: 760,
        clientY: 20,
      });
      expect(setTheme).not.toHaveBeenCalled();
      await act(async () => {});
      expect(start).toHaveBeenCalledOnce();
      expect(animate).toHaveBeenCalledOnce();
      expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
      expect(update).not.toHaveBeenCalled();
      motion.theme = "dark";
      motion.resolved = "dark";
      rerender();
      expect(start).toHaveBeenCalledOnce();
    } finally {
      button.remove();
      window.removeEventListener(THEME_REVEAL_EVENT, prepare);
    }
  });

  it("applies the first native snapshot without an entrance reveal", () => {
    motion.native = true;
    motion.persistence = "loading";
    const { start } = deferredTransition();
    const { rerender } = renderHook(useSynchronizedTheme);
    motion.savedTheme = "dark";
    motion.persistence = "saved";
    rerender();
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["hidden", "app-reduced", "system-reduced"])(
    "applies a synchronized theme without animation when %s",
    (mode) => {
      motion.native = true;
      const { start } = deferredTransition();
      const { rerender } = renderHook(useSynchronizedTheme);
      if (mode === "hidden")
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      if (mode === "app-reduced") motion.value = "reduced";
      if (mode === "system-reduced")
        vi.mocked(window.matchMedia).mockReturnValue({
          matches: true,
        } as MediaQueryList);
      motion.savedTheme = "dark";
      rerender();
      expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
      expect(start).not.toHaveBeenCalled();
    },
  );

  it("keeps the system choice without revealing an unchanged resolved appearance", () => {
    motion.native = true;
    const { start } = deferredTransition();
    const { rerender } = renderHook(useSynchronizedTheme);
    motion.savedTheme = "system";
    rerender();
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("system");
    expect(start).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "reserves the theme cache for first paint while leaving other storage events untouched (native=%s)",
    (native) => {
      motion.native = native;
      const { unmount } = renderHook(useSynchronizedTheme);
      const cacheListener = vi.fn();
      window.addEventListener("storage", cacheListener);
      try {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: THEME_STORAGE_KEY,
            newValue: "dark",
          }),
        );
        expect(cacheListener).not.toHaveBeenCalled();
        window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
        expect(cacheListener).toHaveBeenCalledOnce();
        unmount();
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: THEME_STORAGE_KEY,
            newValue: "dark",
          }),
        );
        expect(cacheListener).toHaveBeenCalledTimes(2);
      } finally {
        window.removeEventListener("storage", cacheListener);
      }
    },
  );

  it("cancels a pending synchronized reveal on unmount", async () => {
    motion.native = true;
    const { start, animate, skip } = deferredTransition();
    const { rerender, unmount } = renderHook(useSynchronizedTheme);
    motion.savedTheme = "dark";
    rerender();
    expect(start).toHaveBeenCalledOnce();
    unmount();
    await act(async () => {});
    expect(skip).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("discards an older remote reveal if the latest revision returns to the current appearance", async () => {
    motion.native = true;
    const { start, animate, skip } = deferredTransition();
    const { rerender } = renderHook(useSynchronizedTheme);
    motion.savedTheme = "dark";
    rerender();
    motion.savedTheme = "light";
    rerender();
    await act(async () => {});
    expect(start).toHaveBeenCalledOnce();
    expect(skip).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("keeps the latest choice when toggled again before the first snapshot commits", async () => {
    const { start, skip } = deferredTransition();
    const { result } = renderHook(useThemeSwitch);
    act(() => {
      result.current.toggle({ clientX: 10, clientY: 20 });
      result.current.toggle({ clientX: 10, clientY: 20 });
    });
    await act(async () => {});
    expect(start).toHaveBeenCalledTimes(2);
    expect(skip).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: "light" });
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("commits a selected theme and releases the reveal when the document becomes hidden", async () => {
    const { animate, skip } = deferredTransition();
    const { result } = renderHook(useThemeSwitch);
    act(() => result.current.toggle({ clientX: 10, clientY: 20 }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {});
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
    expect(skip).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("bases the next local toggle on the applied remote theme after its previous reveal was superseded", async () => {
    motion.native = true;
    deferredTransition();
    const { result, rerender } = renderHook(() => {
      useSynchronizedTheme();
      return useThemeSwitch();
    });
    act(() => result.current.toggle({ clientX: 10, clientY: 20 }));
    motion.savedTheme = "system";
    rerender();
    await act(async () => {});
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("system");
    expect(update).not.toHaveBeenCalled();
    motion.theme = "system";
    rerender();
    await act(async () => result.current.toggle({ clientX: 10, clientY: 20 }));
    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: "dark" });
  });
});

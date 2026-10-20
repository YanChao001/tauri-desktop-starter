import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDemoMotion } from "./use-demo-motion";

const preference = vi.hoisted(() => ({ motion: "full" }));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: preference }),
}));
describe("demo motion activity", () => {
  let reduced = false;
  let pageVisibility = "visible";
  let viewport: IntersectionObserverCallback;
  const mediaListeners = new Set<() => void>();
  const disconnect = vi.fn();
  const initialVisibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  beforeEach(() => {
    preference.motion = "full";
    reduced = false;
    pageVisibility = "visible";
    mediaListeners.clear();
    disconnect.mockClear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => pageVisibility,
    });
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_: string, listener: () => void) =>
        mediaListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        mediaListeners.delete(listener),
    }));
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          viewport = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (initialVisibility)
      Object.defineProperty(document, "visibilityState", initialVisibility);
    else Reflect.deleteProperty(document, "visibilityState");
  });
  it("stops decorative motion for either system or application preference", () => {
    const { result, rerender } = renderHook(() => useDemoMotion());
    expect(result.current.active).toBe(true);
    act(() => {
      reduced = true;
      mediaListeners.forEach((listener) => listener());
    });
    expect(result.current).toMatchObject({ reduced: true, active: false });
    act(() => {
      reduced = false;
      mediaListeners.forEach((listener) => listener());
    });
    expect(result.current.active).toBe(true);
    preference.motion = "reduced";
    rerender();
    expect(result.current.active).toBe(false);
  });
  it("pauses hidden or offscreen scenes and releases its observers on unmount", () => {
    const ref = createRef<HTMLDivElement>();
    ref.current = document.createElement("div");
    const { result, unmount } = renderHook(() => useDemoMotion(ref));
    expect(result.current.active).toBe(true);
    act(() =>
      viewport(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(result.current).toMatchObject({ visible: false, active: false });
    act(() =>
      viewport(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    act(() => {
      pageVisibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.active).toBe(false);
    act(() => {
      pageVisibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.active).toBe(true);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(mediaListeners.size).toBe(0);
  });
});

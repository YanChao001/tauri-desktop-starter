import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFullscreen } from "./use-fullscreen";

const windowState = vi.hoisted(() => ({
  fullscreen: false,
  native: true,
  changed: (() => {}) as () => void,
  isWindowFullscreen: vi.fn(),
  setWindowFullscreen: vi.fn(),
  onWindowResized: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  ...windowState,
  isTauri: () => windowState.native,
}));
beforeEach(() => {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => null,
  });
  windowState.fullscreen = false;
  windowState.native = true;
  windowState.isWindowFullscreen.mockImplementation(
    async () => windowState.fullscreen,
  );
  windowState.setWindowFullscreen.mockImplementation(async (value: boolean) => {
    windowState.fullscreen = value;
    windowState.changed();
  });
  windowState.onWindowResized.mockImplementation(
    async (changed: () => void) => {
      windowState.changed = changed;
      return vi.fn();
    },
  );
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fullscreenElement");
});

it("全屏与退出均等待真实窗口状态，外部退出也会同步布局", async () => {
  const { result } = renderHook(useFullscreen);
  await act(async () => result.current.change());
  expect(result.current.fullscreen).toBe(true);
  await act(async () => {
    windowState.fullscreen = false;
    windowState.changed();
  });
  expect(result.current.fullscreen).toBe(false);
  expect(windowState.setWindowFullscreen).toHaveBeenCalledWith(true);
});

it("系统拒绝全屏时不进入伪全屏布局，可以再次尝试", async () => {
  windowState.setWindowFullscreen.mockRejectedValueOnce(new Error("denied"));
  const { result } = renderHook(useFullscreen);
  await expect(act(async () => result.current.change())).rejects.toThrow(
    "denied",
  );
  expect(result.current.fullscreen).toBe(false);
  await act(async () => result.current.change());
  expect(result.current.fullscreen).toBe(true);
});

it("初始化时同步已恢复的全屏窗口，卸载清理晚到订阅", async () => {
  windowState.fullscreen = true;
  const first = renderHook(useFullscreen);
  await waitFor(() => expect(first.result.current.fullscreen).toBe(true));
  first.unmount();
  let finish!: (stop: () => void) => void;
  windowState.onWindowResized.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stop = vi.fn();
  const second = renderHook(useFullscreen);
  second.unmount();
  await act(async () => finish(stop));
  expect(stop).toHaveBeenCalledOnce();
});

it("浏览器退出事件同步状态，不调用原生查询", async () => {
  windowState.native = false;
  let element: Element | null = document.documentElement;
  vi.spyOn(document, "fullscreenElement", "get").mockImplementation(
    () => element,
  );
  const { result } = renderHook(useFullscreen);
  await waitFor(() => expect(result.current.fullscreen).toBe(true));
  await act(async () => {
    element = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  expect(result.current.fullscreen).toBe(false);
  expect(windowState.isWindowFullscreen).not.toHaveBeenCalled();
});

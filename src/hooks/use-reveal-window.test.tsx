import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revealWindow } from "@/lib/tauri";
import { useRevealWindow } from "./use-reveal-window";

vi.mock("@/lib/tauri", () => ({
  revealWindow: vi.fn().mockResolvedValue(undefined),
}));

describe("useRevealWindow", () => {
  beforeEach(() => {
    vi.mocked(revealWindow).mockClear();
    // 同步执行回调：两帧在这里等价于两次同步调用
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    // 先卸载再还原 mock，保证 effect 的清理逻辑仍能拿到被 spy 的函数
    cleanup();
    vi.restoreAllMocks();
  });

  it("挂载后等两帧再显示窗口，避免闪白", () => {
    renderHook(() => useRevealWindow());

    expect(revealWindow).toHaveBeenCalledTimes(1);
  });

  it("卸载时取消排队中的帧回调", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = renderHook(() => useRevealWindow());

    unmount();

    expect(cancel).toHaveBeenCalled();
  });
});

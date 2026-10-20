import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@/lib/tauri";
import { useNativeResource } from "./use-native-resource";

vi.mock("@/lib/tauri", () => ({ isTauri: vi.fn(() => true) }));

describe("原生资源加载", () => {
  beforeEach(() => vi.mocked(isTauri).mockReturnValue(true));
  afterEach(cleanup);

  it("刷新期间忽略旧请求结果，失败后能重试", async () => {
    let resolveFirst!: (value: string) => void;
    const load = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("current");
    const { result } = renderHook(() => useNativeResource(load));
    await act(() => result.current.reload());
    expect(result.current.error).toEqual(new Error("offline"));
    await act(async () => resolveFirst("stale"));
    expect(result.current.data).toBeNull();
    await act(() => result.current.reload());
    expect(result.current.data).toBe("current");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("切换资源时忽略前一个加载器的结果，浏览器预览不调用原生能力", async () => {
    let finish!: (value: number) => void;
    const original = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const next = vi.fn().mockResolvedValue(2);
    const { result, rerender, unmount } = renderHook(
      ({ loader }) => useNativeResource(loader),
      { initialProps: { loader: original } },
    );
    rerender({ loader: next });
    await waitFor(() => expect(result.current.data).toBe(2));
    await act(async () => finish(1));
    expect(result.current.data).toBe(2);
    unmount();
    vi.mocked(isTauri).mockReturnValue(false);
    const preview = vi.fn().mockResolvedValue(3);
    const browser = renderHook(() => useNativeResource(preview));
    await act(() => browser.result.current.reload());
    expect(preview).not.toHaveBeenCalled();
    expect(browser.result.current.loading).toBe(false);
  });
});

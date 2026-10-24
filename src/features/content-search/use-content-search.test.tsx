import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { useContentSearch } from "./use-content-search";
const state = vi.hoisted(() => ({ native: true, navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.navigate }));
vi.mock("@/providers/commands", () => ({ useRegisterCommands: () => {} }));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => state.native,
  queryNotes: vi.fn(),
  recentWorkbenchFiles: vi.fn(),
}));
const note = (title: string) => ({
  items: [{ id: 2, title, body: "", version: 1, updatedAt: "" }],
  total: 1,
  limit: 8,
  offset: 0,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.native = true;
  vi.mocked(native.recentWorkbenchFiles).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("晚到的旧检索不能替换新查询；结果通过已有路由打开", async () => {
  let old!: (value: ReturnType<typeof note>) => void;
  vi.mocked(native.queryNotes)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    )
    .mockResolvedValueOnce(note("New result"));
  const view = renderHook(({ query }) => useContentSearch(query, true), {
    initialProps: { query: "old" },
  });
  await act(() => vi.advanceTimersByTimeAsync(200));
  view.rerender({ query: "new" });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(view.result.current.commands[0]?.label).toBe("New result");
  await act(async () => old(note("Old result")));
  expect(view.result.current.commands[0]?.label).toBe("New result");
  view.result.current.commands[0]?.run();
  expect(state.navigate).toHaveBeenCalledWith("/database?note=2");
});

it("单类失败仍保留其他结果，浏览器不调用原生检索", async () => {
  vi.mocked(native.queryNotes).mockRejectedValue({ code: "STORAGE_IO" });
  vi.mocked(native.recentWorkbenchFiles).mockResolvedValue([
    { id: "file-2", name: "report.txt", path: "unused", directory: false },
  ]);
  const view = renderHook(() => useContentSearch("report", true));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(view.result.current.failed).toBe(true);
  expect(view.result.current.commands[0]?.label).toBe("report.txt");
  view.unmount();
  vi.clearAllMocks();
  state.native = false;
  renderHook(() => useContentSearch("report", true));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(native.queryNotes).not.toHaveBeenCalled();
});

it("重新打开面板或返回之前的词条时等待新结果，不重新暴露旧快照", async () => {
  vi.mocked(native.queryNotes)
    .mockResolvedValueOnce(note("Old result"))
    .mockResolvedValueOnce(note("Updated result"));
  const view = renderHook(({ query, open }) => useContentSearch(query, open), {
    initialProps: { query: "report", open: true },
  });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(view.result.current.commands[0]?.label).toBe("Old result");
  view.rerender({ query: "report", open: false });
  view.rerender({ query: "report", open: true });
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.commands).toHaveLength(0);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(view.result.current.commands[0]?.label).toBe("Updated result");
  view.rerender({ query: "different", open: true });
  view.rerender({ query: "report", open: true });
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.commands).toHaveLength(0);
});

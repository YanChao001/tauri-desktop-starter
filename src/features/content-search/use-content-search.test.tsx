import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { useContentSearch } from "./use-content-search";
import { useRegisterCommands } from "@/providers/commands";
const state = vi.hoisted(() => ({ native: true, navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.navigate }));
vi.mock("@/providers/commands", () => ({ useRegisterCommands: vi.fn() }));
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
  vi.mocked(native.queryNotes).mockReset();
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

it("浏览器查询变化时复用空命令注册，不触发无意义的全局注册更新", () => {
  state.native = false;
  const view = renderHook(({ query }) => useContentSearch(query, true), {
    initialProps: { query: "re" },
  });
  const registered = vi.mocked(useRegisterCommands).mock.lastCall?.[0];
  expect(registered).toHaveLength(0);

  view.rerender({ query: "report" });
  expect(vi.mocked(useRegisterCommands).mock.lastCall?.[0]).toBe(registered);
  view.rerender({ query: "different" });
  expect(vi.mocked(useRegisterCommands).mock.lastCall?.[0]).toBe(registered);
  expect(native.queryNotes).not.toHaveBeenCalled();
});

it("无匹配和重试等待期间保持空注册，重试命中后注册可导航的结果", async () => {
  vi.mocked(native.queryNotes)
    .mockResolvedValueOnce({ ...note("unused"), items: [], total: 0 })
    .mockRejectedValueOnce({ code: "STORAGE_IO" })
    .mockResolvedValueOnce(note("Recovered result"));
  const view = renderHook(({ query }) => useContentSearch(query, true), {
    initialProps: { query: "missing" },
  });
  const empty = vi.mocked(useRegisterCommands).mock.lastCall?.[0];
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.commands).toHaveLength(0);
  expect(vi.mocked(useRegisterCommands).mock.lastCall?.[0]).toBe(empty);

  view.rerender({ query: "report" });
  expect(vi.mocked(useRegisterCommands).mock.lastCall?.[0]).toBe(empty);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(view.result.current.failed).toBe(true);
  expect(vi.mocked(useRegisterCommands).mock.lastCall?.[0]).toBe(empty);

  act(() => view.result.current.retry());
  expect(view.result.current.loading).toBe(true);
  expect(vi.mocked(useRegisterCommands).mock.lastCall?.[0]).toBe(empty);
  await act(() => vi.advanceTimersByTimeAsync(200));
  const recovered = vi.mocked(useRegisterCommands).mock.lastCall?.[0];
  expect(recovered?.[0]?.label).toBe("Recovered result");
  expect(view.result.current.failed).toBe(false);
  recovered?.[0]?.run();
  expect(state.navigate).toHaveBeenCalledWith("/database?note=2");
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

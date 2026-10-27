import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { WorkbenchTask, WorkbenchTaskSnapshot } from "@/lib/tauri";
import Tasks from "./tasks";
import { toast } from "sonner";

const locale = vi.hoisted(() => ({ language: "keys" as "keys" | "en" | "zh" }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const { zhCN } = await import("@/i18n/zh-CN");
  const translators = {
    keys: (key: string) => key,
    en: createTranslator(en),
    zh: createTranslator(zhCN),
  };
  return {
    useI18n: () => ({
      t: translators[locale.language],
      language: locale.language === "zh" ? "zh" : "en",
    }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  cancelWorkbenchTask: vi.fn(),
  exportWorkbenchTask: vi.fn(),
  getWorkbenchTaskSnapshot: vi.fn(),
  onWorkbenchTasksChanged: vi.fn(),
  pickWorkbenchDirectory: vi.fn(),
  recentWorkbenchFiles: vi.fn(),
  retryWorkbenchTask: vi.fn(),
  startWorkbenchTask: vi.fn(),
}));
const task: WorkbenchTask = {
  id: "task-1",
  directoryId: "dir-1",
  directoryName: "Chosen",
  kind: "sha256",
  status: "running",
  processed: 1,
  total: 2,
  bytes: 3,
  startedAt: "1700000000000",
  finishedAt: null,
  message: null,
  results: [],
  truncated: false,
  attemptOf: null,
};
let listener: ((snapshot: WorkbenchTaskSnapshot) => void) | undefined;
const stop = vi.fn();
beforeEach(() => {
  locale.language = "keys";
  listener = undefined;
  vi.clearAllMocks();
  vi.mocked(native.onWorkbenchTasksChanged).mockImplementation(
    async (handler) => {
      listener = handler;
      return stop;
    },
  );
  vi.mocked(native.getWorkbenchTaskSnapshot).mockResolvedValue({
    revision: 1,
    active: 0,
    queued: 0,
    tasks: [],
  });
  vi.mocked(native.recentWorkbenchFiles).mockResolvedValue([]);
  vi.mocked(native.pickWorkbenchDirectory).mockResolvedValue({
    id: "dir-1",
    name: "Chosen",
    path: "C:/chosen",
  });
  vi.mocked(native.startWorkbenchTask).mockResolvedValue(task);
  vi.mocked(native.cancelWorkbenchTask).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("background task center", () => {
  it("distinguishes a pending first snapshot from an empty history and zero counts", async () => {
    let resolve!: (value: WorkbenchTaskSnapshot) => void;
    vi.mocked(native.getWorkbenchTaskSnapshot).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<Tasks />);
    expect(screen.getAllByText("tasks.loading")).toHaveLength(2);
    expect(screen.queryByText("tasks.empty")).not.toBeInTheDocument();
    expect(screen.queryByText(/tasks.active/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(native.getWorkbenchTaskSnapshot).toHaveBeenCalledOnce(),
    );
    await act(async () =>
      resolve({ revision: 1, active: 0, queued: 0, tasks: [] }),
    );
    expect(screen.getByText("tasks.empty")).toBeVisible();
    expect(screen.queryByText("tasks.loading")).not.toBeInTheDocument();
  });

  it("offers an inline retry after the first snapshot fails without also showing an empty history", async () => {
    vi.mocked(native.getWorkbenchTaskSnapshot).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Tasks />);
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.IO");
    expect(screen.queryByText("tasks.empty")).not.toBeInTheDocument();
    expect(screen.getByText("tasks.countUnavailable")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(await screen.findByText("tasks.empty")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains the inline recovery action when retrying the first snapshot also fails", async () => {
    vi.mocked(native.getWorkbenchTaskSnapshot).mockRejectedValue({
      code: "STORAGE_IO",
    });
    render(<Tasks />);
    const retry = await screen.findByRole("button", { name: "common.retry" });
    fireEvent.click(retry);
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.IO");
    expect(screen.getByRole("button", { name: "common.retry" })).toBeEnabled();
    expect(screen.queryByText("tasks.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("tasks.loading")).not.toBeInTheDocument();
  });

  it("localizes structured task notices and retains original diagnostics behind an expansion", async () => {
    locale.language = "en";
    const diagnostic = "Raw persisted report diagnostic";
    vi.mocked(native.getWorkbenchTaskSnapshot).mockResolvedValueOnce({
      revision: 1,
      active: 0,
      queued: 0,
      tasks: [
        {
          ...task,
          status: "completed",
          message: diagnostic,
          unreadableEntries: 3,
          reportUnavailable: true,
          results: [
            {
              path: "oversized.bin",
              bytes: 0,
              sha256: null,
              error: "Raw oversized file diagnostic",
              failure: {
                code: "INPUT_TOO_LONG",
                message: "Raw oversized file diagnostic",
                retryable: false,
              },
            },
          ],
        },
      ],
    });
    const view = render(<Tasks />);
    expect(
      await screen.findByText(/3 entries could not be read/),
    ).toBeVisible();
    expect(
      screen.getByText(/The complete report could not be saved/),
    ).toBeVisible();
    expect(screen.queryByText(diagnostic)).not.toBeInTheDocument();
    locale.language = "zh";
    view.rerender(<Tasks />);
    expect(screen.getByText(/有 3 项无法读取/)).toBeVisible();
    expect(
      screen.queryByText(/3 entries could not be read/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    expect(
      screen.getByText("文件或路径超出本次任务的处理限制，已跳过。"),
    ).toBeVisible();
    const original = screen.getByText(diagnostic);
    expect(original.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(original.closest("details")!.querySelector("summary")!);
    expect(original.closest("details")).toHaveAttribute("open");
    expect(original).toBeVisible();
  });

  it("uses a localized explanation for legacy string diagnostics without interpreting them", async () => {
    locale.language = "zh";
    vi.mocked(native.getWorkbenchTaskSnapshot).mockResolvedValueOnce({
      revision: 1,
      active: 0,
      queued: 0,
      tasks: [
        { ...task, status: "failed", message: "An unknown old task message" },
      ],
    });
    render(<Tasks />);
    expect(
      await screen.findByText(
        "此历史任务包含附加诊断，可展开结果查看原始记录。",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("An unknown old task message"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    expect(
      screen.getByText("An unknown old task message").closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("keeps startup failures recoverable and clears their alert after a valid event arrives", async () => {
    vi.mocked(native.getWorkbenchTaskSnapshot).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Tasks />);
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.IO");
    act(() => listener?.({ revision: 2, active: 0, queued: 0, tasks: [] }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("reports an operation failure in a toast without inserting a page alert", async () => {
    vi.mocked(native.pickWorkbenchDirectory).mockRejectedValueOnce(
      new Error("Cannot choose directory"),
    );
    render(<Tasks />);
    fireEvent.click(
      screen.getByRole("button", { name: "tasks.pickDirectory" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("common.operationFailed"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("starts a real directory task, requests cancellation and does not cancel on page unmount", async () => {
    const view = render(<Tasks />);
    fireEvent.click(
      screen.getByRole("button", { name: "tasks.pickDirectory" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("tasks.directory")).toHaveTextContent(
        "Chosen",
      ),
    );
    fireEvent.keyDown(screen.getByLabelText("tasks.kind"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "tasks.sha256" }));
    fireEvent.click(screen.getByRole("button", { name: "tasks.start" }));
    await waitFor(() =>
      expect(native.startWorkbenchTask).toHaveBeenCalledWith("sha256", "dir-1"),
    );
    act(() => listener?.({ revision: 2, active: 1, queued: 0, tasks: [task] }));
    fireEvent.click(screen.getByRole("button", { name: "tasks.cancel" }));
    await waitFor(() =>
      expect(native.cancelWorkbenchTask).toHaveBeenCalledOnce(),
    );
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(native.cancelWorkbenchTask).toHaveBeenCalledOnce();
  });

  it("ignores older snapshots after a terminal event and stops accepting events after cleanup", async () => {
    let resolve!: (value: WorkbenchTaskSnapshot) => void;
    vi.mocked(native.getWorkbenchTaskSnapshot).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<Tasks />);
    await waitFor(() =>
      expect(native.getWorkbenchTaskSnapshot).toHaveBeenCalled(),
    );
    act(() =>
      listener?.({
        revision: 3,
        active: 0,
        queued: 0,
        tasks: [{ ...task, status: "completed" }],
      }),
    );
    expect(screen.getByText("tasks.status.completed")).toBeVisible();
    await act(async () =>
      resolve({ revision: 2, active: 1, queued: 0, tasks: [task] }),
    );
    expect(screen.getByText("tasks.status.completed")).toBeVisible();
    expect(screen.queryByText("tasks.status.running")).not.toBeInTheDocument();
    view.unmount();
    act(() => listener?.({ revision: 4, active: 1, queued: 0, tasks: [task] }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("allows queueing while two jobs run, cancels waiting jobs, and bounds the queue", async () => {
    render(<Tasks />);
    fireEvent.click(
      screen.getByRole("button", { name: "tasks.pickDirectory" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("tasks.directory")).toHaveTextContent(
        "Chosen",
      ),
    );
    const waiting = { ...task, id: "task-waiting", status: "queued" as const };
    act(() =>
      listener?.({ revision: 5, active: 2, queued: 1, tasks: [waiting] }),
    );
    expect(screen.getByRole("button", { name: "tasks.start" })).toBeEnabled();
    expect(screen.getByText("tasks.waiting", { exact: false })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "tasks.retry" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tasks.cancel" }));
    await waitFor(() =>
      expect(native.cancelWorkbenchTask).toHaveBeenCalledWith("task-waiting"),
    );
    act(() =>
      listener?.({ revision: 6, active: 2, queued: 10, tasks: [waiting] }),
    );
    expect(screen.getByRole("button", { name: "tasks.start" })).toBeDisabled();
  });
});

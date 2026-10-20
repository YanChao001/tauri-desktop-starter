import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import * as native from "@/lib/tauri";
import type { WorkbenchTask, WorkbenchTaskSnapshot } from "@/lib/tauri";
import Tasks from "./tasks";

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/hooks/use-latest-translator", () => ({
  useLatestTranslator: () => (key: string) => key,
}));
vi.mock("@/components/native-page", () => ({
  NativePage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
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
  it("starts a real directory task, requests cancellation and does not cancel on page unmount", async () => {
    const view = render(<Tasks />);
    fireEvent.click(
      screen.getByRole("button", { name: "tasks.pickDirectory" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("tasks.directory")).toHaveValue("dir-1"),
    );
    fireEvent.change(screen.getByLabelText("tasks.kind"), {
      target: { value: "sha256" },
    });
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
      expect(screen.getByLabelText("tasks.directory")).toHaveValue("dir-1"),
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

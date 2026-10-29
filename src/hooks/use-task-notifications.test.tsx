import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { WorkbenchTask, WorkbenchTaskSnapshot } from "@/lib/tauri";
import type { UnsavedWork } from "@/providers/unsaved-work";
import { useTaskNotifications } from "./use-task-notifications";

const lifecycle = vi.hoisted(() => ({
  work: null as UnsavedWork | null,
  translate: (key: string) => key,
}));
vi.mock("@/providers/unsaved-work", () => ({
  useUnsavedWork: (work: UnsavedWork) => {
    lifecycle.work = work;
  },
}));
vi.mock("@/hooks/use-latest-translator", () => ({
  useLatestTranslator: () => lifecycle.translate,
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("@/lib/tauri", async (original) => ({
  NativeBridgeError: (await original<typeof import("@/lib/tauri")>())
    .NativeBridgeError,
  isTauri: () => true,
  getCurrentWindowLabel: vi.fn(),
  getWorkbenchTaskSnapshot: vi.fn(),
  onWorkbenchTasksChanged: vi.fn(),
  sendSystemNotification: vi.fn(),
  cancelWorkbenchTask: vi.fn(),
}));
const running: WorkbenchTask = {
  id: "task-running",
  directoryId: "directory-1",
  directoryName: "Selected directory",
  kind: "scan",
  status: "running",
  processed: 0,
  total: 0,
  bytes: 0,
  startedAt: "1700000000000",
  finishedAt: null,
  message: null,
  results: [],
  truncated: false,
  attemptOf: null,
};
function snapshot(
  revision: number,
  tasks: WorkbenchTask[],
): WorkbenchTaskSnapshot {
  return {
    revision,
    tasks,
    active: tasks.filter((task) =>
      ["running", "cancelling"].includes(task.status),
    ).length,
    queued: tasks.filter((task) => task.status === "queued").length,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let listener: ((value: WorkbenchTaskSnapshot) => void) | undefined;
const stop = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  listener = undefined;
  lifecycle.work = null;
  vi.mocked(native.getCurrentWindowLabel).mockResolvedValue("main");
  vi.mocked(native.getWorkbenchTaskSnapshot).mockResolvedValue(
    snapshot(1, [running]),
  );
  vi.mocked(native.onWorkbenchTasksChanged).mockImplementation(
    async (handler) => {
      listener = handler;
      return stop;
    },
  );
  vi.mocked(native.sendSystemNotification).mockResolvedValue(true);
  vi.mocked(native.cancelWorkbenchTask).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("global background task lifecycle", () => {
  it("takes an initial baseline and notifies once for a terminal transition without requesting permission", async () => {
    const view = renderHook(useTaskNotifications);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    const complete = snapshot(3, [{ ...running, status: "completed" }]);
    act(() => {
      listener?.(complete);
      listener?.(complete);
      listener?.(snapshot(2, [running]));
    });
    expect(native.sendSystemNotification).toHaveBeenCalledExactlyOnceWith(
      "nav.tasks",
      "Selected directory · tasks.status.completed",
      false,
    );
    expect(lifecycle.work?.dirty).toBe(false);
    view.unmount();
    act(() => listener?.(snapshot(4, [{ ...running, status: "failed" }])));
    expect(native.sendSystemNotification).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not treat historical completed tasks as new notifications or restore stale pending work", async () => {
    const initial = deferred<WorkbenchTaskSnapshot>();
    vi.mocked(native.getWorkbenchTaskSnapshot).mockReturnValue(initial.promise);
    renderHook(useTaskNotifications);
    await waitFor(() =>
      expect(native.getWorkbenchTaskSnapshot).toHaveBeenCalled(),
    );
    act(() => listener?.(snapshot(3, [{ ...running, status: "completed" }])));
    await act(async () => initial.resolve(snapshot(2, [running])));
    expect(lifecycle.work?.dirty).toBe(false);
    expect(native.sendSystemNotification).not.toHaveBeenCalled();
  });

  it("keeps task notifications and exit coordination in the main window", async () => {
    vi.mocked(native.getCurrentWindowLabel).mockResolvedValue("secondary");
    renderHook(useTaskNotifications);
    await waitFor(() =>
      expect(native.getCurrentWindowLabel).toHaveBeenCalled(),
    );
    expect(native.onWorkbenchTasksChanged).not.toHaveBeenCalled();
    expect(native.getWorkbenchTaskSnapshot).not.toHaveBeenCalled();
    expect(lifecycle.work?.dirty).toBe(false);
  });

  it("cancels queued and running tasks and waits until workers settle before approving discard", async () => {
    const queued = { ...running, id: "task-queued", status: "queued" as const };
    const both = snapshot(1, [running, queued]);
    vi.mocked(native.getWorkbenchTaskSnapshot).mockResolvedValue(both);
    renderHook(useTaskNotifications);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    vi.mocked(native.getWorkbenchTaskSnapshot)
      .mockResolvedValueOnce(both)
      .mockResolvedValue(snapshot(2, []));
    await lifecycle.work!.discard();
    expect(vi.mocked(native.cancelWorkbenchTask).mock.calls).toEqual([
      ["task-running"],
      ["task-queued"],
    ]);
  });

  it("waits for tasks to finish without cancelling when save-and-continue is chosen", async () => {
    renderHook(useTaskNotifications);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    vi.mocked(native.getWorkbenchTaskSnapshot)
      .mockResolvedValueOnce(snapshot(1, [running]))
      .mockResolvedValue(snapshot(2, [{ ...running, status: "completed" }]));
    await lifecycle.work!.save();
    expect(native.cancelWorkbenchTask).not.toHaveBeenCalled();
  });

  it("stops cancelling additional tasks when the lifecycle request is aborted", async () => {
    const queued = { ...running, id: "task-queued", status: "queued" as const };
    vi.mocked(native.getWorkbenchTaskSnapshot).mockResolvedValue(
      snapshot(1, [running, queued]),
    );
    renderHook(useTaskNotifications);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    const controller = new AbortController();
    vi.mocked(native.cancelWorkbenchTask).mockImplementation(async () => {
      controller.abort();
    });
    await expect(lifecycle.work!.discard(controller.signal)).rejects.toThrow();
    expect(native.cancelWorkbenchTask).toHaveBeenCalledExactlyOnceWith(
      "task-running",
    );
  });

  it("unregisters listeners whose registration resolves after cleanup", async () => {
    const registration = deferred<() => void>();
    vi.mocked(native.onWorkbenchTasksChanged).mockReturnValue(
      registration.promise,
    );
    const view = renderHook(useTaskNotifications);
    await waitFor(() =>
      expect(native.onWorkbenchTasksChanged).toHaveBeenCalled(),
    );
    view.unmount();
    await act(async () => registration.resolve(stop));
    expect(stop).toHaveBeenCalledOnce();
    expect(native.getWorkbenchTaskSnapshot).not.toHaveBeenCalled();
  });

  it("bounds waiting even when a snapshot stalls and preserves active tasks after timeout", async () => {
    renderHook(useTaskNotifications);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    vi.useFakeTimers();
    const stalled = deferred<WorkbenchTaskSnapshot>();
    vi.mocked(native.getWorkbenchTaskSnapshot)
      .mockClear()
      .mockReturnValueOnce(stalled.promise);
    const waiting = lifecycle.work!.save();
    const rejected = expect(waiting).rejects.toMatchObject({
      code: "NATIVE_BUSY",
    });
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    await rejected;
    expect(lifecycle.work?.dirty).toBe(true);
    expect(native.cancelWorkbenchTask).not.toHaveBeenCalled();
    await act(async () => stalled.resolve(snapshot(2, [running])));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(native.getWorkbenchTaskSnapshot).toHaveBeenCalledOnce();
  });
});

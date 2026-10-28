import { useEffect, useState } from "react";
import {
  getCurrentWindowLabel,
  getWorkbenchTaskSnapshot,
  cancelWorkbenchTask,
  isTauri,
  onWorkbenchTasksChanged,
  sendSystemNotification,
  type WorkbenchTaskStatus,
  NativeBridgeError,
} from "@/lib/tauri";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { reportClientError } from "@/lib/report-error";
import { useUnsavedWork } from "@/providers/unsaved-work";

/** 全局订阅不随任务页卸载；仅主窗口、已获系统授权时发送终态通知。 */
export function useTaskNotifications() {
  const t = useLatestTranslator();
  const [pending, setPending] = useState(0);
  async function settle(cancel: boolean, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(
      () =>
        controller.abort(
          new NativeBridgeError({
            code: "NATIVE_BUSY",
            message:
              "Background tasks did not settle within two minutes; tasks remain active",
            retryable: true,
          }),
        ),
      120_000,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const stopped = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", stopped, { once: true });
        void poll(cancel, controller.signal)
          .then(resolve, reject)
          .finally(() => {
            controller.signal.removeEventListener("abort", stopped);
          });
      });
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  async function poll(cancel: boolean, signal: AbortSignal) {
    for (;;) {
      signal?.throwIfAborted();
      const snapshot = await getWorkbenchTaskSnapshot();
      signal?.throwIfAborted();
      const jobs = snapshot.tasks.filter((task) =>
        ["queued", "running", "cancelling"].includes(task.status),
      );
      if (!jobs.length) return;
      if (cancel)
        for (const job of jobs) {
          signal?.throwIfAborted();
          if (job.status === "cancelling") continue;
          try {
            await cancelWorkbenchTask(job.id);
          } catch (reason) {
            const next = await getWorkbenchTaskSnapshot();
            if (
              next.tasks.some(
                (task) =>
                  task.id === job.id &&
                  ["queued", "running", "cancelling"].includes(task.status),
              )
            )
              throw reason;
          }
        }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    }
  }
  useUnsavedWork({
    id: "background-tasks",
    label: t("lifecycle.tasks"),
    dirty: pending > 0,
    save: (signal) => settle(false, signal),
    discard: (signal) => settle(true, signal),
  });
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let stop: (() => void) | undefined;
    let revision = -1;
    const previous = new Map<string, WorkbenchTaskStatus>();
    void getCurrentWindowLabel()
      .then(async (label) => {
        if (stopped || label !== "main") return;
        const accept = (
          snapshot: Awaited<ReturnType<typeof getWorkbenchTaskSnapshot>>,
        ) => {
          if (stopped || snapshot.revision <= revision) return;
          const first = revision < 0;
          revision = snapshot.revision;
          const ids = new Set(snapshot.tasks.map((task) => task.id));
          for (const id of previous.keys())
            if (!ids.has(id)) previous.delete(id);
          setPending(snapshot.active + snapshot.queued);
          for (const task of snapshot.tasks) {
            const was = previous.get(task.id);
            previous.set(task.id, task.status);
            if (
              !first &&
              was &&
              ["queued", "running", "cancelling"].includes(was) &&
              ["completed", "failed", "cancelled"].includes(task.status)
            ) {
              void sendSystemNotification(
                t("nav.tasks"),
                `${task.directoryName} · ${t(`tasks.status.${task.status}`)}`,
                false,
              ).catch(reportClientError);
            }
          }
        };
        const unlisten = await onWorkbenchTasksChanged(accept);
        if (stopped) unlisten();
        else {
          stop = unlisten;
          accept(await getWorkbenchTaskSnapshot());
        }
      })
      .catch(reportClientError);
    return () => {
      stopped = true;
      stop?.();
    };
  }, [t]);
}

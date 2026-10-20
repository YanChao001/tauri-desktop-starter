import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpenIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { NativePage } from "@/components/native-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { nativeErrorText } from "@/lib/native-error";
import {
  isTauri,
  cancelWorkbenchTask,
  exportWorkbenchTask,
  getWorkbenchTaskSnapshot,
  onWorkbenchTasksChanged,
  pickWorkbenchDirectory,
  recentWorkbenchFiles,
  retryWorkbenchTask,
  startWorkbenchTask,
  type WorkbenchDirectory,
  type WorkbenchTaskKind,
  type WorkbenchTaskSnapshot,
} from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";

export default function Tasks() {
  const { t, language } = useI18n();
  const latest = useLatestTranslator();
  const [snapshot, setSnapshot] = useState<WorkbenchTaskSnapshot | null>(null);
  const [directories, setDirectories] = useState<WorkbenchDirectory[]>([]);
  const [directoryId, setDirectoryId] = useState("");
  const [kind, setKind] = useState<WorkbenchTaskKind>("scan");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const accept = useCallback((next: WorkbenchTaskSnapshot) => {
    if (mounted.current)
      setSnapshot((current) =>
        !current || next.revision >= current.revision ? next : current,
      );
  }, []);
  const refresh = useCallback(
    async () => accept(await getWorkbenchTaskSnapshot()),
    [accept],
  );
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    if (isTauri()) {
      void onWorkbenchTasksChanged((next) => {
        if (!disposed) accept(next);
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          stop = unlisten;
          void refresh().catch((reason) => {
            if (!disposed) setError(reason);
          });
        })
        .catch((reason) => {
          if (!disposed) setError(reason);
        });
      void recentWorkbenchFiles()
        .then((entries) => {
          if (!disposed)
            setDirectories(
              entries
                .filter((entry) => entry.directory)
                .map(({ id, name, path }) => ({ id, name, path })),
            );
        })
        .catch((reason) => {
          if (!disposed) setError(reason);
        });
    }
    const timer = window.setInterval(() => {
      if (isTauri() && document.visibilityState !== "hidden")
        void refresh().catch((reason) => {
          if (!disposed) setError(reason);
        });
    }, 1500);
    return () => {
      mounted.current = false;
      disposed = true;
      stop?.();
      window.clearInterval(timer);
    };
  }, [accept, refresh]);
  const perform = useCallback(
    async (id: string, action: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setPending(id);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (reason) {
        if (mounted.current) setError(reason);
      } finally {
        running.current = false;
        if (mounted.current) setPending(null);
      }
    },
    [refresh],
  );
  return (
    <NativePage title={t("tasks.title")} description={t("tasks.description")}>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {nativeErrorText(error, t)}
        </p>
      ) : null}
      <section
        className="space-y-4 rounded-xl border bg-card p-4"
        aria-busy={pending !== null}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Button
            variant="outline"
            disabled={pending !== null}
            onClick={() =>
              void perform("pick", async () => {
                const directory = await pickWorkbenchDirectory();
                if (directory && mounted.current) {
                  setDirectories((entries) => [
                    directory,
                    ...entries.filter((entry) => entry.id !== directory.id),
                  ]);
                  setDirectoryId(directory.id);
                }
              })
            }
          >
            <FolderOpenIcon />
            {t("tasks.pickDirectory")}
          </Button>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="task-directory">{t("tasks.directory")}</Label>
            <select
              id="task-directory"
              value={directoryId}
              disabled={pending !== null}
              onChange={(event) => setDirectoryId(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t("tasks.noDirectory")}</option>
              {directories.map((directory) => (
                <option key={directory.id} value={directory.id}>
                  {directory.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-kind">{t("tasks.kind")}</Label>
            <select
              id="task-kind"
              value={kind}
              disabled={pending !== null}
              onChange={(event) =>
                setKind(event.target.value as WorkbenchTaskKind)
              }
              className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="scan">{t("tasks.scan")}</option>
              <option value="sha256">{t("tasks.sha256")}</option>
            </select>
          </div>
          <Button
            disabled={
              !directoryId || pending !== null || (snapshot?.queued ?? 0) >= 10
            }
            onClick={() =>
              void perform("start", async () => {
                await startWorkbenchTask(kind, directoryId);
              })
            }
          >
            <PlayIcon />
            {t("tasks.start")}
          </Button>
          <Button
            variant="ghost"
            disabled={pending !== null}
            aria-label={t("common.refresh")}
            onClick={() => void perform("refresh", refresh)}
          >
            <RefreshCwIcon />
          </Button>
        </div>
        {directoryId ? (
          <p className="break-all font-mono text-xs text-muted-foreground">
            {
              directories.find((directory) => directory.id === directoryId)
                ?.path
            }
          </p>
        ) : null}
        <p role="status" className="text-sm">
          {t("tasks.active", { count: snapshot?.active ?? 0 })}
          {" · "}
          {t("tasks.queued", { count: snapshot?.queued ?? 0 })}
        </p>
        {(snapshot?.active ?? 0) >= 2 ? (
          <p className="text-xs text-muted-foreground">{t("tasks.capacity")}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("tasks.limits")}</p>
      </section>
      <div>
        <h3 className="text-base font-medium">{t("tasks.history")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("tasks.historyHint")}
        </p>
      </div>
      {!snapshot?.tasks.length ? (
        <p className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
          {t("tasks.empty")}
        </p>
      ) : (
        <ul className="space-y-4">
          {snapshot.tasks.map((task) => {
            const active =
              task.status === "queued" ||
              task.status === "running" ||
              task.status === "cancelling";
            const executing =
              task.status === "running" || task.status === "cancelling";
            return (
              <li
                key={task.id}
                className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="min-w-0 flex-1 break-words text-sm font-medium">
                    {t(task.kind === "scan" ? "tasks.scan" : "tasks.sha256")} ·{" "}
                    {task.directoryName}
                  </h4>
                  <Badge
                    variant={
                      task.status === "failed" ? "destructive" : "outline"
                    }
                  >
                    {t(`tasks.status.${task.status}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(Number(task.startedAt)).toLocaleString(
                      language === "zh" ? "zh-CN" : "en",
                    )}
                  </span>
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {task.id}
                </p>
                <Progress
                  value={
                    task.total > 0
                      ? Math.min(100, (task.processed / task.total) * 100)
                      : executing
                        ? undefined
                        : 0
                  }
                  aria-label={t("tasks.progress", {
                    processed: task.processed,
                    total: task.total,
                  })}
                />
                <p role="status" className="text-xs text-muted-foreground">
                  {task.status === "queued"
                    ? t("tasks.waiting")
                    : task.total === 0 && executing
                      ? t("tasks.discovering")
                      : t("tasks.progress", {
                          processed: task.processed,
                          total: task.total,
                        })}{" "}
                  · {(task.bytes ?? 0).toLocaleString()} B
                </p>
                {task.message ? (
                  <p className="break-words text-sm">{task.message}</p>
                ) : null}
                {task.truncated ? (
                  <p className="text-sm text-destructive">
                    {t("tasks.truncated")}
                  </p>
                ) : null}
                {task.attemptOf ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {t("tasks.retryOf", { id: task.attemptOf })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {active ? (
                    <Button
                      variant="outline"
                      disabled={
                        pending !== null || task.status === "cancelling"
                      }
                      onClick={() =>
                        void perform(task.id, () =>
                          cancelWorkbenchTask(task.id),
                        )
                      }
                    >
                      {t("tasks.cancel")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        disabled={pending !== null || snapshot.queued >= 10}
                        onClick={() =>
                          void perform(task.id, async () => {
                            await retryWorkbenchTask(task.id);
                          })
                        }
                      >
                        {t("tasks.retry")}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending !== null}
                        onClick={() =>
                          void perform(task.id, async () => {
                            const path = await exportWorkbenchTask(task.id);
                            if (path && mounted.current)
                              toast.success(latest("tasks.exported"));
                          })
                        }
                      >
                        {t("tasks.export")}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    aria-expanded={expanded === task.id}
                    onClick={() =>
                      setExpanded((id) => (id === task.id ? null : task.id))
                    }
                  >
                    {t(
                      expanded === task.id
                        ? "tasks.hideResults"
                        : "tasks.results",
                    )}
                  </Button>
                </div>
                {expanded === task.id ? (
                  <div className="min-w-0 space-y-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      {t("tasks.previewLimit")}
                    </p>
                    {task.results.length ? (
                      <div className="max-h-80 overflow-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr>
                              <th className="p-2">{t("tasks.path")}</th>
                              <th className="p-2">{t("tasks.bytes")}</th>
                              <th className="p-2">{t("tasks.hash")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {task.results.map((entry, index) => (
                              <tr key={index} className="border-t">
                                <td className="max-w-64 break-all p-2">
                                  {entry.path}
                                </td>
                                <td className="whitespace-nowrap p-2">
                                  {(entry.bytes ?? 0).toLocaleString()}
                                </td>
                                <td className="max-w-96 break-all p-2 font-mono">
                                  {entry.error ?? entry.sha256 ?? "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("tasks.noResults")}
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </NativePage>
  );
}

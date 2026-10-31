import { getLocale } from "@/i18n/registry";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpenIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { NativePage, ResourceError } from "@/components/native-page";
import { HelpTooltip } from "@/components/help-tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type WorkbenchTask,
  type WorkbenchTaskSnapshot,
} from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import type { Translate } from "@/i18n/translate";

function taskNotice(task: WorkbenchTask, t: Translate) {
  const messages: string[] = [];
  const unreadableEntries = task.unreadableEntries ?? 0;
  if (task.status === "interrupted") messages.push(t("tasks.interruptedHint"));
  if (task.failure) messages.push(nativeErrorText(task.failure, t));
  if (unreadableEntries > 0)
    messages.push(t("tasks.unreadableEntries", { count: unreadableEntries }));
  if (task.reportUnavailable) messages.push(t("tasks.reportUnavailable"));
  if (task.truncated) messages.push(t("tasks.truncated"));
  if (!messages.length && task.message) messages.push(t("tasks.legacyNotice"));
  return messages.join(" · ");
}

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
    if (mounted.current) {
      setSnapshot((current) =>
        !current || next.revision > current.revision ? next : current,
      );
      setError(null);
    }
  }, []);
  useEffect(() => {
    if (error && snapshot)
      toast.error(nativeErrorText(error, latest), {
        id: "tasks-refresh-error",
      });
  }, [error, snapshot, latest]);
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
            setDirectories((current) => [
              ...current,
              ...entries
                .filter(
                  (entry) =>
                    entry.directory &&
                    !current.some((directory) => directory.id === entry.id),
                )
                .map(({ id, name, path }) => ({ id, name, path })),
            ]);
        })
        .catch((reason) => {
          if (!disposed) toast.error(nativeErrorText(reason, latest));
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
  }, [accept, refresh, latest]);
  const perform = useCallback(
    async (id: string, action: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setPending(id);
      setError(null);
      try {
        await action();
        if (id !== "refresh") await refresh();
      } catch (reason) {
        if (mounted.current) {
          if (id === "refresh") setError(reason);
          else toast.error(nativeErrorText(reason, latest));
        }
      } finally {
        running.current = false;
        if (mounted.current) setPending(null);
      }
    },
    [refresh, latest],
  );
  return (
    <NativePage title={t("tasks.title")} description={t("tasks.description")}>
      <section
        className="@container space-y-3 rounded-xl border app-surface p-4"
        aria-busy={pending !== null || (!snapshot && !error)}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 @3xl:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <div className="col-span-2 min-w-0 space-y-1.5 @3xl:col-span-1">
            <Label htmlFor="task-directory">{t("tasks.directory")}</Label>
            <div className="flex min-w-0 items-center gap-2">
              <Select
                value={directoryId || "__none__"}
                disabled={pending !== null}
                onValueChange={(value) =>
                  setDirectoryId(value === "__none__" ? "" : value)
                }
              >
                <SelectTrigger id="task-directory" className="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="__none__">
                    {t("tasks.noDirectory")}
                  </SelectItem>
                  {directories.map((directory) => (
                    <SelectItem key={directory.id} value={directory.id}>
                      {directory.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="task-kind">{t("tasks.kind")}</Label>
            <Select
              value={kind}
              disabled={pending !== null}
              onValueChange={(value) => setKind(value as WorkbenchTaskKind)}
            >
              <SelectTrigger id="task-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="scan">{t("tasks.scan")}</SelectItem>
                <SelectItem value="sha256">{t("tasks.sha256")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={
                !directoryId ||
                pending !== null ||
                (snapshot?.queued ?? 0) >= 10
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
              size="icon"
              disabled={pending !== null}
              aria-label={t("common.refresh")}
              onClick={() => void perform("refresh", refresh)}
            >
              <RefreshCwIcon />
            </Button>
          </div>
        </div>
        <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <div className="flex shrink-0 items-center gap-1">
            <p role="status" className="tabular-nums">
              {snapshot
                ? `${t("tasks.active", { count: snapshot.active })} · ${t("tasks.queued", { count: snapshot.queued })}`
                : t(error ? "tasks.countUnavailable" : "tasks.loading")}
            </p>
          </div>
          {directoryId ? (
            <div className="flex min-w-0 items-center gap-1">
              <p className="min-w-0 truncate">
                {
                  directories.find((directory) => directory.id === directoryId)
                    ?.path
                }
              </p>
              <HelpTooltip
                label={`${t("tasks.directory")} · ${t("title.help")}`}
              >
                {
                  directories.find((directory) => directory.id === directoryId)
                    ?.path
                }
              </HelpTooltip>
            </div>
          ) : null}
        </div>
      </section>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-medium">{t("tasks.history")}</h3>
      </div>
      {!snapshot ? (
        error ? (
          <ResourceError
            error={error}
            retry={() => void perform("refresh", refresh)}
          />
        ) : (
          <p
            role="status"
            className="rounded-xl border app-surface p-4 text-sm text-muted-foreground"
          >
            {t("tasks.loading")}
          </p>
        )
      ) : !snapshot.tasks.length ? (
        <p className="rounded-xl border app-surface p-4 text-sm text-muted-foreground">
          {t("tasks.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {snapshot.tasks.map((task) => {
            const active =
              task.status === "queued" ||
              task.status === "running" ||
              task.status === "cancelling";
            const executing =
              task.status === "running" || task.status === "cancelling";
            const notice = taskNotice(task, t);
            return (
              <li
                key={task.id}
                className="min-w-0 space-y-3 rounded-xl border app-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="min-w-0 flex-1 truncate text-sm font-medium">
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
                      getLocale(language).documentLang,
                    )}
                  </span>
                </div>
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
                <p
                  role="status"
                  className="h-5 truncate text-xs tabular-nums text-muted-foreground"
                >
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
                <div className="flex h-6 min-w-0 items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm">{notice}</p>
                  <HelpTooltip
                    label={`${t("tasks.results")} · ${t("title.help")}`}
                  >
                    <p className="break-all">{task.id}</p>
                    {notice ? <p>{notice}</p> : null}
                    {task.attemptOf ? (
                      <p>{t("tasks.retryOf", { id: task.attemptOf })}</p>
                    ) : null}
                    <p>{t("tasks.previewLimit")}</p>
                  </HelpTooltip>
                </div>
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
                    {task.message || task.failure?.message ? (
                      <details
                        data-disclosure-radius="md"
                        className="border text-xs"
                      >
                        <summary className="cursor-pointer px-3 py-2 font-medium">
                          {t("tasks.diagnostics")}
                        </summary>
                        <p
                          tabIndex={0}
                          className="mx-3 my-2 max-h-32 overflow-auto whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {task.message ?? task.failure?.message}
                        </p>
                      </details>
                    ) : null}
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
                                <td className="max-w-96 break-all p-2">
                                  {entry.failure || entry.error ? (
                                    <div className="space-y-1">
                                      <p>
                                        {entry.failure
                                          ? entry.failure.code ===
                                            "INPUT_TOO_LONG"
                                            ? t("tasks.entryLimit")
                                            : nativeErrorText(entry.failure, t)
                                          : t("tasks.entryFailed")}
                                      </p>
                                      <details>
                                        <summary className="cursor-pointer text-muted-foreground">
                                          {t("tasks.diagnostics")}
                                        </summary>
                                        <p
                                          tabIndex={0}
                                          className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                          {entry.error ??
                                            entry.failure?.message}
                                        </p>
                                      </details>
                                    </div>
                                  ) : (
                                    <span className="font-mono">
                                      {entry.sha256 ?? "—"}
                                    </span>
                                  )}
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

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FilePlus2Icon, FolderOpenIcon, SaveIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NativePage } from "@/components/native-page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpTooltip } from "@/components/help-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { workbenchEditor } from "@/components/workbench/editor-store";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { nativeErrorText } from "@/lib/native-error";
import {
  isTauri,
  createNote,
  loadWorkbenchDocument,
  onWorkbenchDrop,
  pickWorkbenchFiles,
  recentWorkbenchFiles,
  revealWorkbenchFile,
  saveWorkbenchAs,
  saveWorkbenchDocument,
  type RecentWorkbenchFile,
  type WorkbenchDocument,
} from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";
import { useRegisterCommands } from "@/providers/commands";
import { useUnsavedWork } from "@/providers/unsaved-work";
import type { AppCommand } from "@/commands/types";

const DocumentPreview = lazy(() =>
  import("@/components/workbench/document-preview").then((module) => ({
    default: module.DocumentPreview,
  })),
);
const TextDiff = lazy(() =>
  import("@/components/text-diff").then((module) => ({
    default: module.TextDiff,
  })),
);

export default function Workbench() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedFile = searchParams.get("file");
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const state = useSyncExternalStore(
    workbenchEditor.subscribe,
    workbenchEditor.getSnapshot,
    workbenchEditor.getSnapshot,
  );
  const selected = state.entries.find(
    (entry) => entry.document.id === state.selectedId,
  );
  const dirty = selected
    ? selected.draft !== (selected.document.content ?? "")
    : false;
  const documentBytes = useMemo(
    () =>
      selected?.document.kind === "image"
        ? (selected.document.bytes ?? 0)
        : new TextEncoder().encode(selected?.draft ?? "").byteLength,
    [selected],
  );
  const [recent, setRecent] = useState<RecentWorkbenchFile[]>([]);
  const [error, setError] = useState<unknown>(null);
  const pending = state.pending;
  const [conflict, setConflict] = useState(false);
  const [remote, setRemote] = useState<WorkbenchDocument | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (error && !conflict) toast.error(nativeErrorText(error, latest));
  }, [error, conflict, latest]);
  useEffect(() => {
    if (!requestedFile || pending || !isTauri()) return;
    let stopped = false;
    const selectedAtRequest = workbenchEditor.getSnapshot().selectedId;
    const documentAtRequest = workbenchEditor
      .getSnapshot()
      .entries.find(
        (entry) => entry.document.id === selectedAtRequest,
      )?.document;
    const selectionIsCurrent = () => {
      const current = workbenchEditor.getSnapshot();
      return (
        current.selectedId === selectedAtRequest &&
        current.entries.find((entry) => entry.document.id === selectedAtRequest)
          ?.document === documentAtRequest
      );
    };
    const clearRequest = () =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (next.get("file") === requestedFile) next.delete("file");
          return next;
        },
        { replace: true },
      );
    void loadWorkbenchDocument(requestedFile)
      .then((document) => {
        const current = workbenchEditor.getSnapshot();
        if (stopped || current.pending) return;
        if (selectionIsCurrent()) workbenchEditor.open([document]);
        clearRequest();
      })
      .catch((reason: unknown) => {
        if (stopped || workbenchEditor.getSnapshot().pending) return;
        if (selectionIsCurrent()) setError(reason);
        clearRequest();
      });
    return () => {
      stopped = true;
    };
  }, [requestedFile, pending, setSearchParams]);
  const jsonError = useMemo(() => {
    if (selected?.document.kind !== "json") return false;
    try {
      JSON.parse(selected.draft);
      return false;
    } catch {
      return true;
    }
  }, [selected]);
  const refreshRecent = useCallback(async () => {
    const entries = await recentWorkbenchFiles();
    if (mounted.current) setRecent(entries.filter((entry) => !entry.directory));
  }, []);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    if (isTauri()) {
      void refreshRecent().catch((reason) => {
        if (!disposed) setError(reason);
      });
      void onWorkbenchDrop((batch) => {
        if (disposed) return;
        workbenchEditor.open(batch.files);
        if (batch.errors.length)
          toast.error(batch.errors[0], {
            description: batch.errors.slice(1).join("\n") || undefined,
          });
        void refreshRecent().catch((reason) => {
          if (!disposed) setError(reason);
        });
      })
        .then((unlisten) => {
          if (disposed) unlisten();
          else stop = unlisten;
        })
        .catch((reason) => {
          if (!disposed) setError(reason);
        });
    }
    return () => {
      mounted.current = false;
      disposed = true;
      stop?.();
    };
  }, [refreshRecent]);
  useUnsavedWork({
    id: "workbench",
    label: t("nav.workbench"),
    dirty: workbenchEditor.hasUnsavedChanges() || pending,
    save: async (signal) => {
      signal?.throwIfAborted();
      if (!workbenchEditor.beginOperation())
        throw new Error(latest("workbench.busy"));
      try {
        for (const entry of workbenchEditor.getSnapshot().entries) {
          signal?.throwIfAborted();
          if (entry.draft === (entry.document.content ?? "")) continue;
          const saved = entry.document.path
            ? await saveWorkbenchDocument(
                entry.document.id,
                entry.draft,
                entry.document.revision,
              )
            : await saveWorkbenchAs(entry.document.name, entry.draft);
          if (!saved) throw new Error(latest("workbench.saveCancelled"));
          workbenchEditor.accept(saved, entry.document.id);
          signal?.throwIfAborted();
        }
      } finally {
        workbenchEditor.finishOperation();
      }
    },
    discard: async (signal) => {
      if (workbenchEditor.getSnapshot().pending)
        throw new Error(latest("workbench.busy"));
      for (const entry of workbenchEditor.getSnapshot().entries) {
        signal?.throwIfAborted();
        workbenchEditor.accept(entry.document);
      }
    },
  });
  useEffect(() => {
    setConflict(false);
    setError(null);
  }, [state.selectedId]);
  const perform = useCallback(async (action: () => Promise<void>) => {
    if (!workbenchEditor.beginOperation()) return;
    setError(null);
    try {
      await action();
    } catch (reason) {
      if (mounted.current) {
        setError(reason);
        if (
          typeof reason === "object" &&
          reason !== null &&
          "code" in reason &&
          reason.code === "CONFLICT"
        )
          setConflict(true);
      }
    } finally {
      workbenchEditor.finishOperation();
    }
  }, []);
  const open = useCallback(
    () =>
      perform(async () => {
        const documents = await pickWorkbenchFiles();
        workbenchEditor.open(documents);
        await refreshRecent();
      }),
    [perform, refreshRecent],
  );
  const save = useCallback(
    (copy = false) =>
      perform(async () => {
        if (!selected || selected.document.kind === "image" || jsonError)
          return;
        const document =
          copy || !selected.document.path
            ? await saveWorkbenchAs(selected.document.name, selected.draft)
            : await saveWorkbenchDocument(
                selected.document.id,
                selected.draft,
                selected.document.revision,
              );
        if (!document) return;
        workbenchEditor.accept(
          document,
          copy && selected.document.path ? document.id : selected.document.id,
        );
        if (mounted.current) {
          setConflict(false);
          toast.success(latest("workbench.saved"));
        }
        await refreshRecent();
      }),
    [selected, jsonError, perform, latest, refreshRecent],
  );
  const importNote = useCallback(
    () =>
      perform(async () => {
        if (!selected || selected.document.kind === "image" || jsonError)
          return;
        if (new TextEncoder().encode(selected.draft).byteLength > 65536)
          throw new Error(latest("workbench.noteLimit"));
        await createNote({
          title: Array.from(selected.document.name).slice(0, 200).join(""),
          body: selected.draft,
        });
        if (mounted.current) {
          toast.success(latest("workbench.imported"), {
            action: {
              label: latest("workbench.openNotes"),
              onClick: () => navigate("/database"),
            },
          });
        }
      }),
    [selected, jsonError, perform, latest, navigate],
  );
  const commands = useMemo<AppCommand[]>(
    () => [
      {
        id: "workbench:import-note",
        labelKey: "workbench.importNote",
        group: "tools",
        available: () =>
          isTauri() &&
          !!selected &&
          selected.document.kind !== "image" &&
          !pending &&
          !jsonError,
        run: importNote,
      },
      {
        id: "workbench:open",
        labelKey: "workbench.open",
        group: "tools",
        available: () => isTauri() && !pending,
        shortcuts: [{ key: "o", primary: true, allowInEditable: true }],
        run: open,
      },
      {
        id: "workbench:save",
        labelKey: "workbench.save",
        group: "tools",
        available: () =>
          isTauri() &&
          !!selected &&
          dirty &&
          !pending &&
          !jsonError &&
          selected.document.kind !== "image",
        shortcuts: [{ key: "s", primary: true, allowInEditable: true }],
        run: () => save(),
      },
    ],
    [pending, selected, dirty, jsonError, open, save, importNote],
  );
  useRegisterCommands(commands);
  function close(id: string) {
    const entry = state.entries.find((item) => item.document.id === id);
    if (entry && entry.draft !== (entry.document.content ?? "")) setCloseId(id);
    else workbenchEditor.close(id);
  }
  const previewLoading = (
    <p role="status" className="text-sm text-muted-foreground">
      {t("common.loading")}
    </p>
  );
  return (
    <NativePage
      title={t("workbench.title")}
      description={t("workbench.description")}
    >
      <div className="flex flex-wrap gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button disabled={pending} onClick={() => void open()}>
                <FolderOpenIcon />
                {t("workbench.open")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p>{t("workbench.drop")}</p>
              <p>{t("workbench.limits")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            workbenchEditor.open([
              {
                id: `draft-${crypto.randomUUID()}`,
                name: t("workbench.untitled"),
                path: "",
                kind: "text",
                content: "",
                previewUrl: null,
                revision: "",
                bytes: 0,
              },
            ])
          }
        >
          <FilePlus2Icon />
          {t("workbench.new")}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            const id = `draft-sample-${crypto.randomUUID()}`;
            workbenchEditor.open([
              {
                id,
                name: "desktop-demo.json",
                path: "",
                kind: "json",
                content: "",
                previewUrl: null,
                revision: "",
                bytes: 0,
              },
            ]);
            workbenchEditor.edit(
              id,
              JSON.stringify(
                {
                  formatVersion: 1,
                  title: t("workbench.sampleTitle"),
                  items: [
                    { name: "read", completed: true },
                    { name: "export", completed: false },
                  ],
                },
                null,
                2,
              ),
            );
          }}
        >
          {t("workbench.sample")}
        </Button>
      </div>
      {error && conflict ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {conflict ? t("workbench.conflict") : nativeErrorText(error, t)}
        </p>
      ) : null}
      {state.activationErrors.length ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <ul role="alert" className="max-h-28 overflow-auto">
            {state.activationErrors.map((reason, index) => (
              <li key={index}>
                {typeof reason === "string"
                  ? reason
                  : nativeErrorText(reason, t)}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              workbenchEditor.clearActivationErrors();
            }}
          >
            {t("workbench.clearOpenErrors")}
          </Button>
        </div>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,4fr)]">
        <aside className="space-y-4">
          {state.entries.length ? (
            <div className="rounded-lg border app-surface p-3">
              <h3 className="mb-2 text-sm font-medium">
                {t("workbench.documents")}
              </h3>
              <ul className="space-y-1">
                {state.entries.map((entry) => (
                  <li
                    key={entry.document.id}
                    className="flex min-w-0 items-center gap-1"
                  >
                    <Button
                      variant={
                        entry.document.id === state.selectedId
                          ? "secondary"
                          : "ghost"
                      }
                      className="min-w-0 flex-1 justify-start"
                      disabled={pending}
                      aria-pressed={entry.document.id === state.selectedId}
                      onClick={() => workbenchEditor.select(entry.document.id)}
                    >
                      <span className="truncate">
                        {entry.document.name}
                        {entry.draft !== (entry.document.content ?? "")
                          ? " *"
                          : ""}
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      aria-label={`${t("workbench.close")} ${entry.document.name}`}
                      onClick={() => close(entry.document.id)}
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="rounded-lg border app-surface p-3" open>
            <summary className="cursor-pointer text-sm font-medium">
              {t("workbench.recent")}
            </summary>
            {recent.length ? (
              <ul className="mt-2 space-y-1">
                {recent.map((entry) => (
                  <li key={entry.id}>
                    <button
                      disabled={pending}
                      className="w-full truncate rounded-md px-2 py-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      title={entry.path}
                      onClick={() =>
                        void perform(async () =>
                          workbenchEditor.open([
                            await loadWorkbenchDocument(entry.id),
                          ]),
                        )
                      }
                    >
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("workbench.noRecent")}
              </p>
            )}
          </details>
        </aside>
        {selected ? (
          <section
            className="min-w-0 space-y-4 rounded-xl border app-surface p-4"
            aria-busy={pending}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 basis-40 truncate font-medium">
                {selected.document.name}
              </h3>
              {!selected.document.path || dirty ? (
                <Badge variant="outline">
                  {t(
                    selected.document.path
                      ? "workbench.dirty"
                      : "workbench.localDraft",
                  )}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {documentBytes.toLocaleString()} B
              </span>
            </div>
            {selected.document.path ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {selected.document.path}
                </p>
                <HelpTooltip
                  className="shrink-0"
                  label={`${selected.document.name} · ${t("title.help")}`}
                >
                  {selected.document.path}
                </HelpTooltip>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {selected.document.kind !== "image" ? (
                <>
                  <Button
                    disabled={pending || !dirty || jsonError}
                    onClick={() => void save()}
                  >
                    <SaveIcon />
                    {t("workbench.save")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending || jsonError}
                    onClick={() => void save(true)}
                  >
                    {t("workbench.saveAs")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending || jsonError}
                    onClick={() => void importNote()}
                  >
                    {t("workbench.importNote")}
                  </Button>
                </>
              ) : (
                <Badge variant="secondary">{t("workbench.image")}</Badge>
              )}
              <Button
                variant="outline"
                disabled={pending || !selected.document.path}
                onClick={() =>
                  void perform(async () => {
                    const disk = await loadWorkbenchDocument(
                      selected.document.id,
                    );
                    if (mounted.current) setRemote(disk);
                  })
                }
              >
                {t("workbench.reload")}
              </Button>
              <Button
                variant="ghost"
                disabled={pending || !selected.document.path}
                onClick={() =>
                  void perform(() => revealWorkbenchFile(selected.document.id))
                }
              >
                {t("workbench.reveal")}
              </Button>
            </div>
            {selected.remoteChanged && !conflict ? (
              <p role="alert" className="text-sm text-destructive">
                {t("workbench.conflict")}
              </p>
            ) : null}
            {selected.document.kind !== "image" ? (
              <div className="space-y-2">
                <div className="flex min-h-6 min-w-0 items-center gap-2">
                  <Label htmlFor="workbench-editor" className="shrink-0">
                    {t("workbench.editor")}
                  </Label>
                  <p
                    id="workbench-json-error"
                    role={jsonError ? "alert" : undefined}
                    className="min-w-0 truncate text-xs text-destructive"
                  >
                    {jsonError ? t("workbench.invalidJson") : null}
                  </p>
                  {jsonError ? (
                    <HelpTooltip
                      label={`${t("workbench.editor")} · ${t("title.help")}`}
                    >
                      {t("workbench.invalidJson")}
                    </HelpTooltip>
                  ) : null}
                </div>
                <Textarea
                  id="workbench-editor"
                  rows={14}
                  disabled={pending}
                  value={selected.draft}
                  aria-invalid={jsonError}
                  aria-describedby={
                    jsonError ? "workbench-json-error" : undefined
                  }
                  onChange={(event) =>
                    workbenchEditor.edit(
                      selected.document.id,
                      event.target.value,
                    )
                  }
                  className="font-mono"
                />
              </div>
            ) : null}
            <div className="min-w-0 space-y-2 border-t pt-4">
              <h4 className="text-sm font-medium">{t("workbench.preview")}</h4>
              <Suspense fallback={previewLoading}>
                <DocumentPreview
                  document={selected.document}
                  content={selected.draft}
                />
              </Suspense>
            </div>
          </section>
        ) : (
          <p className="rounded-xl border app-surface p-4 text-sm text-muted-foreground">
            {t("workbench.empty")}
          </p>
        )}
      </div>
      <Dialog
        open={remote !== null}
        onOpenChange={(open) => {
          if (!open) setRemote(null);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
          closeLabel={t("common.close")}
        >
          <DialogHeader>
            <DialogTitle>{t("workbench.diskVersion")}</DialogTitle>
            <DialogDescription>
              {t("workbench.diskDescription")}
            </DialogDescription>
          </DialogHeader>
          {remote ? (
            <div className="space-y-4">
              <Suspense fallback={previewLoading}>
                <DocumentPreview
                  document={remote}
                  content={remote.content ?? ""}
                />
              </Suspense>
              {selected &&
              selected.document.id === remote.id &&
              remote.kind !== "image" ? (
                <Suspense fallback={previewLoading}>
                  <TextDiff
                    local={selected.draft}
                    remote={remote.content ?? ""}
                    disabled={pending}
                    onApply={(content) => {
                      workbenchEditor.accept(remote);
                      workbenchEditor.edit(remote.id, content);
                      setRemote(null);
                      setConflict(false);
                      setError(null);
                    }}
                  />
                </Suspense>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemote(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (remote) workbenchEditor.accept(remote);
                setRemote(null);
                setConflict(false);
                setError(null);
              }}
            >
              {t("workbench.useDisk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={closeId !== null}
        onOpenChange={(open) => {
          if (!open) setCloseId(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("workbench.discardTitle")}</DialogTitle>
            <DialogDescription>
              {t("workbench.discardDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseId(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (closeId) workbenchEditor.close(closeId);
                setCloseId(null);
              }}
            >
              {t("workbench.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NativePage>
  );
}

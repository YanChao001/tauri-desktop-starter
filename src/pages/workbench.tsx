import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FilePlus2Icon, FolderOpenIcon, SaveIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
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
import { DocumentPreview } from "@/components/workbench/document-preview";
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

export default function Workbench() {
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
  const [recent, setRecent] = useState<RecentWorkbenchFile[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [dropErrors, setDropErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [remote, setRemote] = useState<WorkbenchDocument | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
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
        setDropErrors(batch.errors);
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
    dirty: workbenchEditor.hasUnsavedChanges(),
    save: async (signal) => {
      if (running.current) throw new Error(latest("workbench.busy"));
      running.current = true;
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
        running.current = false;
      }
    },
    discard: async (signal) => {
      if (running.current) throw new Error(latest("workbench.busy"));
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
    if (running.current) return;
    running.current = true;
    setPending(true);
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
      running.current = false;
      if (mounted.current) setPending(false);
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
          setImported(true);
          toast.success(latest("workbench.imported"));
        }
      }),
    [selected, jsonError, perform, latest],
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
  return (
    <NativePage
      title={t("workbench.title")}
      description={t("workbench.description")}
    >
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void open()}>
          <FolderOpenIcon />
          {t("workbench.open")}
        </Button>
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
      <div className="rounded-xl border border-dashed bg-muted/30 p-5 text-sm">
        <p>{t("workbench.drop")}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("workbench.limits")}
        </p>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {conflict ? t("workbench.conflict") : nativeErrorText(error, t)}
        </p>
      ) : null}
      {dropErrors.length ? (
        <ul role="alert" className="rounded-lg border p-3 text-sm">
          {dropErrors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,4fr)]">
        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-3">
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
          <details className="rounded-lg border bg-card p-3" open>
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
            className="min-w-0 space-y-4 rounded-xl border bg-card p-4"
            aria-busy={pending}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate font-medium">
                {selected.document.name}
              </h3>
              {dirty ? (
                <Badge variant="outline">{t("workbench.dirty")}</Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {(selected.document.bytes ?? 0).toLocaleString()} B
              </span>
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {selected.document.path || t("workbench.localDraft")}
            </p>
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
            {imported && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("workbench.imported")}{" "}
                <a className="underline underline-offset-4" href="#/database">
                  {t("workbench.openNotes")}
                </a>
              </p>
            )}
            {selected.remoteChanged && !conflict ? (
              <p role="alert" className="text-sm text-destructive">
                {t("workbench.conflict")}
              </p>
            ) : null}
            {selected.document.kind !== "image" ? (
              <div className="space-y-2">
                <Label htmlFor="workbench-editor">
                  {t("workbench.editor")}
                </Label>
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
                {jsonError ? (
                  <p
                    id="workbench-json-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {t("workbench.invalidJson")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="min-w-0 space-y-2 border-t pt-4">
              <h4 className="text-sm font-medium">{t("workbench.preview")}</h4>
              <DocumentPreview
                document={selected.document}
                content={selected.draft}
              />
            </div>
          </section>
        ) : (
          <p className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
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
            <DocumentPreview document={remote} content={remote.content ?? ""} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemote(null)}>
              {t("common.cancel")}
            </Button>
            <Button
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

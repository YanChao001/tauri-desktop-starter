import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PlusIcon, SaveIcon, TrashIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { NativePage, ResourceError } from "@/components/native-page";
import { BackupPanel } from "@/components/database/backup-panel";
import { ConflictPanel } from "@/components/database/conflict-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useNativeResource } from "@/hooks/use-native-resource";
import { useUnsavedWork } from "@/providers/unsaved-work";
import {
  createNote,
  updateNote,
  queryNotes,
  getNote,
  changeNotes,
  loadNoteDraft,
  saveNoteDraft,
  onNotesChanged,
  isTauri,
  type Note,
  type NoteDraft,
} from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { cn } from "@/lib/utils";
type Draft = {
  id: number | null;
  title: string;
  body: string;
  version: number;
};
const blank = (): Draft => ({ id: null, title: "", body: "", version: 0 });
const utf8Length = (value: string) => new TextEncoder().encode(value).length;
// 每个 WebView 共用一个编辑器，路由切换时保留待写入操作和未保存编辑
type EditorState = {
  draft: Draft;
  original: Draft;
  pending: boolean;
  error: unknown;
};
let editor: EditorState = {
  draft: blank(),
  original: blank(),
  pending: false,
  error: null,
};
const editorListeners = new Set<() => void>();
const readEditor = () => editor;
let draftWrites: Promise<void> = Promise.resolve();
let saving: Promise<void> | null = null;
const subscribeEditor = (listener: () => void) => {
  editorListeners.add(listener);
  return () => {
    editorListeners.delete(listener);
  };
};
function changeEditor(patch: Partial<EditorState>) {
  editor = { ...editor, ...patch };
  editorListeners.forEach((listener) => listener());
}
function applyDraft(next: Draft) {
  changeEditor({ draft: next, original: next, error: null });
}
function isDirty(draft: Draft, original: Draft) {
  return draft.title !== original.title || draft.body !== original.body;
}
function persistDraft() {
  const value: NoteDraft | null = isDirty(editor.draft, editor.original)
    ? {
        noteId: editor.draft.id,
        title: editor.draft.title,
        body: editor.draft.body,
        expectedVersion: editor.draft.id === null ? null : editor.draft.version,
        originalTitle: editor.original.title,
        originalBody: editor.original.body,
      }
    : null;
  draftWrites = draftWrites.catch(() => {}).then(() => saveNoteDraft(value));
  return draftWrites;
}
function recoverDraft(value: NoteDraft | null) {
  if (!value) return;
  changeEditor({
    draft: {
      id: value.noteId,
      title: value.title,
      body: value.body,
      version: value.expectedVersion ?? 0,
    },
    original: {
      id: value.noteId,
      title: value.originalTitle,
      body: value.originalBody,
      version: value.expectedVersion ?? 0,
    },
  });
}
export default function Database() {
  const { t, language } = useI18n();
  const latest = useLatestTranslator();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("updated-desc");
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const load = useCallback(
    () => queryNotes({ search, offset, limit: 50, sort, trash }),
    [search, offset, sort, trash],
  );
  const { data: page, error, loading, reload } = useNativeResource(load);
  const notes = page?.items;
  const {
    draft,
    original,
    pending,
    error: mutationError,
  } = useSyncExternalStore(subscribeEditor, readEditor, readEditor);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkAction, setBulkAction] = useState<
    "trash" | "restore" | "purge" | null
  >(null);
  const [remote, setRemote] = useState<Note | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState<"recovered" | "saved" | null>(
    null,
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const nextDraft = useRef<Draft | null>(null);
  const mounted = useRef(false);
  const dirty = isDirty(draft, original);
  const searchTooLong = utf8Length(query) > 200;
  const bodyTooLong = utf8Length(draft.body) > 65536;
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    if (editor.pending || isDirty(editor.draft, editor.original)) {
      setDraftReady(true);
      return;
    }
    void draftWrites
      .catch(() => {})
      .then(() => loadNoteDraft())
      .then((value) => {
        if (
          !stopped &&
          !editor.pending &&
          !isDirty(editor.draft, editor.original)
        ) {
          recoverDraft(value);
          if (value) setDraftNotice("recovered");
        }
        if (!stopped) setDraftReady(true);
      })
      .catch((reason) => {
        if (!stopped) changeEditor({ error: reason });
      });
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!draftReady || !isTauri() || bodyTooLong || draft.title.length > 200)
      return;
    const timer = setTimeout(() => {
      void persistDraft()
        .then(() => {
          if (mounted.current)
            setDraftNotice(
              isDirty(editor.draft, editor.original) ? "saved" : null,
            );
        })
        .catch((reason) => changeEditor({ error: reason }));
    }, 200);
    return () => clearTimeout(timer);
  }, [draft, original, draftReady, bodyTooLong]);
  useEffect(
    () => () => {
      if (
        draftReady &&
        isTauri() &&
        utf8Length(editor.draft.body) <= 65536 &&
        editor.draft.title.length <= 200
      ) {
        void persistDraft().catch((reason) => changeEditor({ error: reason }));
      }
    },
    [draftReady],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!editor.pending && !isDirty(editor.draft, editor.original))
        applyDraft(blank());
    };
  }, []);
  useEffect(() => {
    if (searchTooLong || query === search) return;
    const timeout = setTimeout(() => {
      setSearch(query);
      setOffset(0);
      setSelected(new Set());
    }, 180);
    return () => clearTimeout(timeout);
  }, [query, search, searchTooLong]);
  useEffect(() => {
    if (
      !notes ||
      editor.pending ||
      isDirty(editor.draft, editor.original) ||
      editor.draft.id === null
    )
      return;
    const current = notes.find((note) => note.id === editor.draft.id);
    // 筛选结果未包含当前笔记，不代表笔记已被删除
    if (current && current.version > editor.draft.version) applyDraft(current);
  }, [notes, pending, draft.id, draft.version, dirty, search]);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void onNotesChanged(() => {
      if (!stopped) void reload();
    })
      .then((stop) => {
        if (stopped) stop();
        else {
          unlisten = stop;
          void reload();
        }
      })
      .catch((reason) => {
        if (!stopped) changeEditor({ error: reason });
      });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [reload]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function select(next: Draft) {
    if (editor.pending) return;
    if (dirty) {
      nextDraft.current = next;
      setDiscardOpen(true);
      return;
    }
    applyDraft(next);
    setRemote(null);
  }
  function save(asCopy = false): Promise<void> {
    if (saving) return saving;
    if (editor.pending) return Promise.reject({ code: "CONFLICT" });
    if (
      !editor.draft.title.trim() ||
      utf8Length(editor.draft.body) > 65536 ||
      (!asCopy && !isDirty(editor.draft, editor.original))
    )
      return isDirty(editor.draft, editor.original)
        ? Promise.reject({ code: "INVALID_ARGUMENT" })
        : Promise.resolve();
    const current = editor.draft;
    changeEditor({ pending: true, error: null });
    const operation = async () => {
      try {
        const note =
          current.id === null || asCopy
            ? await createNote({ title: current.title, body: current.body })
            : await updateNote({
                id: current.id,
                title: current.title,
                body: current.body,
                expectedVersion: current.version,
              });
        applyDraft(note);
        setRemote(null);
        await persistDraft();
        if (mounted.current) {
          await reload();
          if (mounted.current) toast.success(latest("database.saved"));
        }
      } catch (reason) {
        changeEditor({ error: reason });
        if (
          current.id !== null &&
          typeof reason === "object" &&
          reason &&
          "code" in reason &&
          reason.code === "CONFLICT"
        ) {
          void getNote(current.id)
            .then((value) => {
              if (mounted.current && editor.draft.id === current.id)
                setRemote(value);
            })
            .catch(() => {});
        }
        throw reason;
      } finally {
        changeEditor({ pending: false });
        saving = null;
      }
    };
    saving = operation();
    return saving;
  }
  async function discard() {
    if (saving) await saving.catch(() => {});
    applyDraft(editor.original);
    setRemote(null);
    await persistDraft();
    setDraftReady(true);
  }
  useUnsavedWork({
    id: "note-editor",
    label: t("database.title"),
    dirty: dirty || pending,
    save: () => save(),
    discard,
  });
  async function remove() {
    if (editor.draft.id === null || editor.pending) return;
    const id = editor.draft.id;
    changeEditor({ pending: true, error: null });
    try {
      await changeNotes(
        [{ id, expectedVersion: editor.draft.version }],
        "trash",
      );
      applyDraft(blank());
      await persistDraft();
      if (mounted.current) {
        setConfirmDelete(false);
        await reload();
        if (mounted.current) toast.success(latest("database.deleted"));
      }
    } catch (reason) {
      changeEditor({ error: reason });
    } finally {
      changeEditor({ pending: false });
    }
  }
  function editNote(note: Note) {
    select({
      id: note.id,
      title: note.title,
      body: note.body,
      version: note.version,
    });
  }
  async function mutateSelected(action: "trash" | "restore" | "purge") {
    if (editor.pending) return;
    const items =
      notes
        ?.filter((note) => selected.has(note.id))
        .map((note) => ({ id: note.id, expectedVersion: note.version })) ?? [];
    if (!items.length) return;
    changeEditor({ pending: true, error: null });
    try {
      await changeNotes(items, action);
      if (items.some((item) => item.id === editor.draft.id)) {
        applyDraft(blank());
        await persistDraft();
      }
      setSelected(new Set());
      setBulkAction(null);
      await reload();
    } catch (reason) {
      changeEditor({ error: reason });
    } finally {
      changeEditor({ pending: false });
    }
  }
  const conflicted =
    typeof mutationError === "object" &&
    mutationError !== null &&
    "code" in mutationError &&
    (mutationError.code === "CONFLICT" || mutationError.code === "NOT_FOUND");
  return (
    <NativePage
      title={t("database.title")}
      description={t("database.description")}
    >
      <ResourceError error={error} retry={() => void reload()} />
      {mutationError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-background p-3 text-sm"
        >
          {nativeErrorText(mutationError, t)}
        </div>
      ) : null}
      {conflicted ? (
        <ConflictPanel
          remote={remote}
          pending={pending}
          keepLocal={() => {
            if (!remote) return;
            changeEditor({
              original: { ...remote },
              draft: { ...editor.draft, version: remote.version },
              error: null,
            });
            setRemote(null);
          }}
          saveCopy={() => void save(true).catch(() => {})}
        />
      ) : null}
      {draftNotice && dirty ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(
            draftNotice === "recovered"
              ? "data.draftRecovered"
              : "data.draftSaved",
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          maxLength={200}
          className="min-w-48 flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("database.searchPlaceholder")}
          aria-label={t("database.search")}
          aria-invalid={searchTooLong}
          aria-describedby={searchTooLong ? "note-search-error" : undefined}
        />
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => select(blank())}
        >
          <PlusIcon />
          {t("database.new")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={loading}
          onClick={() => void reload()}
          aria-label={t("common.refresh")}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={!trash ? "default" : "outline"}
          aria-pressed={!trash}
          onClick={() => {
            setTrash(false);
            setOffset(0);
            setSelected(new Set());
          }}
        >
          {t("data.active")}
        </Button>
        <Button
          size="sm"
          variant={trash ? "default" : "outline"}
          aria-pressed={trash}
          onClick={() => {
            setTrash(true);
            setOffset(0);
            setSelected(new Set());
          }}
        >
          {t("data.trash")}
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Label htmlFor="notes-sort">{t("data.sort")}</Label>
          <Select
            value={sort}
            onValueChange={(value) => {
              setSort(value);
              setOffset(0);
              setSelected(new Set());
            }}
          >
            <SelectTrigger id="notes-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="updated-desc">{t("data.newest")}</SelectItem>
              <SelectItem value="updated-asc">{t("data.oldest")}</SelectItem>
              <SelectItem value="title-asc">{t("data.byTitle")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {selected.size ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3">
          <span className="text-sm">
            {t("data.selected", { count: selected.size })}
          </span>
          {trash ? (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => setBulkAction("restore")}
              >
                {t("data.restoreSelected")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => setBulkAction("purge")}
              >
                {t("data.purge")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => setBulkAction("trash")}
            >
              {t("data.trashSelected")}
            </Button>
          )}
        </div>
      ) : null}
      {searchTooLong ? (
        <p
          id="note-search-error"
          role="alert"
          className="text-xs text-destructive"
        >
          {t("errors.INPUT_TOO_LONG")}
        </p>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="max-h-[28rem] space-y-1 overflow-y-auto p-3">
            {loading && !notes ? (
              <p className="p-3 text-xs text-muted-foreground">
                {t("common.loading")}
              </p>
            ) : !notes?.length ? (
              <p className="p-3 text-sm text-muted-foreground">
                {t(search ? "database.noResults" : "database.empty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {notes.map((note) => (
                  <li key={note.id} className="flex items-center gap-1">
                    <Checkbox
                      className="ml-2"
                      aria-label={t("data.selectNote", { title: note.title })}
                      checked={selected.has(note.id)}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(note.id);
                          else next.delete(note.id);
                          return next;
                        })
                      }
                    />
                    <button
                      type="button"
                      disabled={pending}
                      aria-pressed={draft.id === note.id}
                      onClick={() => editNote(note)}
                      className={cn(
                        "min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted",
                        draft.id === note.id && "bg-primary/10",
                      )}
                    >
                      <span className="block truncate text-sm font-medium">
                        {note.title}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {new Date(note.updatedAt).toLocaleString(
                          language === "zh" ? "zh-CN" : "en",
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => {
                  setOffset(Math.max(0, offset - 50));
                  setSelected(new Set());
                }}
              >
                {t("data.previous")}
              </Button>
              <span>
                {t("data.pageCount", {
                  from: page?.total ? offset + 1 : 0,
                  to: Math.min(offset + 50, page?.total ?? 0),
                  total: page?.total ?? 0,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || offset + 50 >= (page?.total ?? 0)}
                onClick={() => {
                  setOffset(offset + 50);
                  setSelected(new Set());
                }}
              >
                {t("data.next")}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4 pt-5">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save().catch(() => {});
              }}
              aria-busy={pending}
            >
              <div className="space-y-1.5">
                <Label htmlFor="note-title">{t("database.titleLabel")}</Label>
                <Input
                  id="note-title"
                  data-testid="note-title"
                  maxLength={200}
                  required
                  value={draft.title}
                  disabled={pending || trash}
                  onChange={(event) =>
                    changeEditor({
                      draft: { ...editor.draft, title: event.target.value },
                    })
                  }
                  placeholder={t("database.titlePlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note-body">{t("database.bodyLabel")}</Label>
                <Textarea
                  id="note-body"
                  data-testid="note-body"
                  maxLength={65536}
                  aria-invalid={bodyTooLong}
                  aria-describedby={bodyTooLong ? "note-body-error" : undefined}
                  rows={12}
                  value={draft.body}
                  disabled={pending || trash}
                  onChange={(event) =>
                    changeEditor({
                      draft: { ...editor.draft, body: event.target.value },
                    })
                  }
                  placeholder={t("database.bodyPlaceholder")}
                />
                {bodyTooLong ? (
                  <p
                    id="note-body-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {t("errors.INPUT_TOO_LONG")}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    trash ||
                    !draftReady ||
                    !draft.title.trim() ||
                    !dirty ||
                    bodyTooLong
                  }
                >
                  <SaveIcon />
                  {t("common.save")}
                </Button>
                {draft.id !== null && !trash ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon />
                    {t("common.delete")}
                  </Button>
                ) : null}
                {dirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void discard().catch((reason) =>
                        changeEditor({ error: reason }),
                      )
                    }
                  >
                    {t("data.discardEdits")}
                  </Button>
                ) : null}
                {dirty ? (
                  <Badge variant="outline">{t("database.unsaved")}</Badge>
                ) : draft.version ? (
                  <span className="text-xs text-muted-foreground">
                    {t("database.version", { version: draft.version })}
                  </span>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      <BackupPanel
        dirty={dirty}
        pending={pending}
        beforeBackup={persistDraft}
        lockEditor={(locked) => changeEditor({ pending: locked })}
        afterRestore={async () => {
          applyDraft(blank());
          recoverDraft(await loadNoteDraft());
          setOffset(0);
          setSelected(new Set());
          await reload();
        }}
      />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("database.confirmDelete")}</DialogTitle>
            <DialogDescription>{t("data.trashDescription")}</DialogDescription>
          </DialogHeader>
          {mutationError ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(mutationError, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void remove()}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setBulkAction(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>
              {t(
                bulkAction === "purge"
                  ? "data.purge"
                  : bulkAction === "restore"
                    ? "data.restoreSelected"
                    : "data.trashSelected",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(bulkAction === "purge" ? "data.purgeHint" : "data.batchHint", {
                count: selected.size,
              })}
            </DialogDescription>
          </DialogHeader>
          {mutationError ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(mutationError, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setBulkAction(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant={bulkAction === "restore" ? "default" : "destructive"}
              disabled={pending}
              onClick={() => {
                if (bulkAction) void mutateSelected(bulkAction);
              }}
            >
              {t("data.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("database.discardTitle")}</DialogTitle>
            <DialogDescription>
              {t("database.discardDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (nextDraft.current) applyDraft(nextDraft.current);
                nextDraft.current = null;
                setDiscardOpen(false);
              }}
            >
              {t("database.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NativePage>
  );
}

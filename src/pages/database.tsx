import { getLocale } from "@/i18n/registry";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PlusIcon, SaveIcon, TrashIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { NativePage, ResourceError } from "@/components/native-page";
import { BackupPanel } from "@/components/database/backup-panel";
import { ConflictPanel } from "@/components/database/conflict-panel";
import { HelpTooltip } from "@/components/help-tooltip";
import { PageLoading } from "@/components/page-loading";
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
  NativeBridgeError,
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
  ready: boolean;
  pending: boolean;
  error: unknown;
};
let editor: EditorState = {
  draft: blank(),
  original: blank(),
  ready: false,
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
function setDraftReady(ready: boolean) {
  changeEditor({ ready });
}
function applyDraft(next: Draft) {
  changeEditor({ draft: next, original: next, error: null });
}
function isDirty(draft: Draft, original: Draft) {
  return draft.title !== original.title || draft.body !== original.body;
}
function persistDraft(signal?: AbortSignal) {
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
  draftWrites = draftWrites
    .catch(() => {})
    .then(() => {
      signal?.throwIfAborted();
      return saveNoteDraft(value);
    });
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedNote = searchParams.get("note");
  const { t, language } = useI18n();
  const latest = useLatestTranslator();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("updated-desc");
  const [trash, setTrash] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const load = useCallback(
    () => queryNotes({ search, offset, limit: 50, sort, trash }),
    [search, offset, sort, trash],
  );
  const { data: page, error, loading, reload } = useNativeResource(load);
  const latestReload = useRef(reload);
  useLayoutEffect(() => {
    latestReload.current = reload;
  }, [reload]);
  const notes = page?.items;
  const {
    draft,
    original,
    ready: draftReady,
    pending,
    error: mutationError,
  } = useSyncExternalStore(subscribeEditor, readEditor, readEditor);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkAction, setBulkAction] = useState<
    "trash" | "restore" | "purge" | null
  >(null);
  const [remote, setRemote] = useState<Note | null>(null);
  const [draftNotice, setDraftNotice] = useState<"recovered" | "saved" | null>(
    null,
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const nextDraft = useRef<Draft | null>(null);
  const mounted = useRef(false);
  const draftRead = useRef(0);
  const dirty = isDirty(draft, original);
  useEffect(() => {
    if (
      !requestedNote ||
      !/^[1-9]\d{0,9}$/.test(requestedNote) ||
      Number(requestedNote) > 2_147_483_647 ||
      !draftReady ||
      pending ||
      !isTauri()
    )
      return;
    let stopped = false;
    const originalAtRequest = editor.original;
    const clearRequest = () =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (next.get("note") === requestedNote) next.delete("note");
          return next;
        },
        { replace: true },
      );
    void getNote(Number(requestedNote))
      .then((note) => {
        if (stopped || editor.pending) return;
        if (editor.original !== originalAtRequest) {
          clearRequest();
          return;
        }
        if (isDirty(editor.draft, editor.original)) {
          nextDraft.current = note;
          setDiscardOpen(true);
        } else {
          applyDraft(note);
          setRemote(null);
        }
        clearRequest();
      })
      .catch((reason: unknown) => {
        if (stopped) return;
        if (editor.original === originalAtRequest)
          changeEditor({ error: reason });
        clearRequest();
      });
    return () => {
      stopped = true;
    };
  }, [requestedNote, draftReady, pending, setSearchParams]);
  const searchTooLong = utf8Length(query) > 200;
  const bodyTooLong = utf8Length(draft.body) > 65536;
  useEffect(() => {
    if (!isTauri() || pending || draftReady || mutationError) return;
    let stopped = false;
    if (isDirty(editor.draft, editor.original)) {
      setDraftReady(true);
      return;
    }
    const request = ++draftRead.current;
    void draftWrites
      .catch(() => {})
      .then(() => loadNoteDraft())
      .then((value) => {
        if (stopped || request !== draftRead.current) return;
        if (!editor.pending && !isDirty(editor.draft, editor.original)) {
          recoverDraft(value);
          if (value) setDraftNotice("recovered");
        }
        setDraftReady(true);
      })
      .catch((reason) => {
        if (!stopped && request === draftRead.current)
          changeEditor({ error: reason });
      });
    return () => {
      stopped = true;
    };
  }, [pending, draftReady, mutationError]);
  useEffect(() => {
    if (
      !draftReady ||
      !dirty ||
      pending ||
      !isTauri() ||
      bodyTooLong ||
      draft.title.length > 200
    )
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
  }, [draft, original, draftReady, bodyTooLong, pending, dirty]);
  useEffect(
    () => () => {
      if (
        draftReady &&
        !editor.pending &&
        isDirty(editor.draft, editor.original) &&
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
      if (!editor.pending && !isDirty(editor.draft, editor.original)) {
        applyDraft(blank());
        setDraftReady(false);
      }
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
      if (!stopped) void latestReload.current();
    })
      .then((stop) => {
        if (stopped) stop();
        else {
          unlisten = stop;
          // 订阅建立后的快照补齐首次查询期间的事件；筛选变化不重建订阅。
          void latestReload.current();
        }
      })
      .catch((reason) => {
        if (!stopped) changeEditor({ error: reason });
      });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function editDraft(draft: Draft) {
    changeEditor({ draft });
    if (draftReady && !isDirty(draft, editor.original))
      void persistDraft().catch((reason) => changeEditor({ error: reason }));
  }
  async function readRecoveredDraft() {
    const request = ++draftRead.current;
    try {
      const recovered = await loadNoteDraft();
      if (request !== draftRead.current) return;
      recoverDraft(recovered);
      setDraftReady(true);
      changeEditor({ error: null });
      if (mounted.current && recovered) setDraftNotice("recovered");
    } catch (reason) {
      if (request !== draftRead.current) return;
      changeEditor({ error: reason });
      throw reason;
    }
  }
  async function retryDraft() {
    if (editor.pending) return;
    changeEditor({ pending: true, error: null });
    try {
      await readRecoveredDraft();
    } catch {
      // 保留读取错误，用户可重试；未读取的草稿不会被清空。
    } finally {
      changeEditor({ pending: false });
    }
  }
  function select(next: Draft) {
    if (editor.pending || !editor.ready) return;
    if (dirty) {
      nextDraft.current = next;
      setDiscardOpen(true);
      return;
    }
    applyDraft(next);
    setCreating(next.id === null);
    if (next.id === null) {
      setTrash(false);
      setOffset(0);
      setSelected(new Set());
    }
    setRemote(null);
  }
  async function save(asCopy = false, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (saving) {
      await saving;
      signal?.throwIfAborted();
      return;
    }
    if (editor.pending)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "A note operation is already in progress",
        retryable: false,
      });
    if (
      !editor.draft.title.trim() ||
      utf8Length(editor.draft.body) > 65536 ||
      (!asCopy && !isDirty(editor.draft, editor.original))
    )
      return isDirty(editor.draft, editor.original)
        ? Promise.reject(
            new NativeBridgeError({
              code: "INVALID_ARGUMENT",
              message: "The note cannot be saved with the current input",
              retryable: false,
            }),
          )
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
        if (mounted.current) setCreating(false);
        setRemote(null);
        signal?.throwIfAborted();
        await persistDraft(signal);
        signal?.throwIfAborted();
        if (mounted.current) {
          await reload();
          if (mounted.current) toast.success(latest("database.saved"));
        }
      } catch (reason) {
        if (signal?.aborted) throw reason;
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
  async function discard(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (saving) await saving.catch(() => {});
    signal?.throwIfAborted();
    if (editor.pending)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "A note operation is already in progress",
        retryable: false,
      });
    changeEditor({ pending: true });
    try {
      applyDraft(editor.original);
      if (mounted.current) setCreating(false);
      setRemote(null);
      await persistDraft(signal);
      signal?.throwIfAborted();
      setDraftReady(true);
    } finally {
      changeEditor({ pending: false });
    }
  }
  useUnsavedWork({
    id: "note-editor",
    label: t("database.title"),
    dirty: dirty || pending,
    save: (signal) => save(false, signal),
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
      if (mounted.current) setCreating(false);
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
        if (mounted.current) setCreating(false);
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
  const showWorkspace =
    !page ||
    !draftReady ||
    page.total > 0 ||
    creating ||
    draft.id !== null ||
    dirty ||
    pending;
  const inlineConflict = conflicted && !confirmDelete && bulkAction === null;
  useEffect(() => {
    if (!draftReady || !mutationError) return;
    if (inlineConflict) toast.dismiss("note-editor-error");
    else
      toast.error(nativeErrorText(mutationError, latest), {
        id: "note-editor-error",
      });
  }, [draftReady, mutationError, inlineConflict, latest]);
  useEffect(() => {
    if (error && page)
      toast.error(nativeErrorText(error, latest), { id: "note-query-error" });
  }, [error, page, latest]);
  return (
    <NativePage
      title={t("database.title")}
      description={t("database.description")}
    >
      <ResourceError error={page ? null : error} retry={() => void reload()} />
      {!draftReady ? (
        mutationError ? (
          <ResourceError
            error={mutationError}
            retry={() => void retryDraft()}
          />
        ) : (
          <PageLoading />
        )
      ) : mutationError && inlineConflict ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-background p-3 text-sm"
        >
          {nativeErrorText(mutationError, t)}
        </div>
      ) : null}
      {conflicted ? (
        <ConflictPanel
          local={draft}
          remote={remote}
          pending={pending}
          keepLocal={() => {
            if (!remote) return;
            changeEditor({
              original: { ...remote },
              error: null,
            });
            editDraft({ ...editor.draft, version: remote.version });
            setRemote(null);
          }}
          saveCopy={() => void save(true).catch(() => {})}
          merge={(value) => {
            if (!remote || pending || remote.id !== editor.draft.id) return;
            changeEditor({ original: { ...remote }, error: null });
            editDraft({ ...editor.draft, ...value, version: remote.version });
            setRemote(null);
          }}
        />
      ) : null}
      <div className="@container/notes space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="grid min-w-0 flex-1 basis-80 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2"
            role="group"
            aria-label={t("database.search")}
          >
            <Input
              type="search"
              maxLength={200}
              className="min-w-0"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("database.searchPlaceholder")}
              aria-label={t("database.search")}
              aria-invalid={searchTooLong}
              aria-describedby={searchTooLong ? "note-search-error" : undefined}
            />
            <Button
              disabled={pending || !draftReady}
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
          <BackupPanel
            dirty={dirty}
            pending={pending || !draftReady}
            flushDraft={persistDraft}
            lockEditor={(locked) => changeEditor({ pending: locked })}
            afterRestore={async () => {
              setDraftReady(false);
              applyDraft(blank());
              setCreating(false);
              setRemote(null);
              setOffset(0);
              setSelected(new Set());
              try {
                await readRecoveredDraft();
              } finally {
                await reload();
              }
            }}
          />
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
          <p
            id="note-search-error"
            role={searchTooLong ? "alert" : undefined}
            className="min-w-0 flex-1 truncate text-xs text-destructive"
          >
            {searchTooLong ? t("search.limit") : null}
          </p>
          {searchTooLong ? (
            <HelpTooltip label={`${t("database.search")} · ${t("title.help")}`}>
              {t("search.limit")}
            </HelpTooltip>
          ) : null}
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
              <SelectTrigger id="notes-sort" size="sm">
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
        {showWorkspace ? (
          <div className="grid items-stretch gap-3 @min-[46rem]/notes:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
            <Card className="min-h-0 min-w-0" data-testid="notes-list">
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex min-h-7 flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-medium">
                    {t(trash ? "data.trash" : "data.active")}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t("data.selected", { count: selected.size })}
                  </span>
                  {selected.size > 0 ? (
                    trash ? (
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
                    )
                  ) : null}
                </div>
                <div className="max-h-72 min-h-20 flex-1 overflow-y-auto">
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
                            aria-label={t("data.selectNote", {
                              title: note.title,
                            })}
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
                                getLocale(language).documentLang,
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
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
            <Card className="min-w-0" data-testid="note-editor">
              <CardContent className="space-y-3">
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save().catch(() => {});
                  }}
                  aria-busy={pending}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="note-title">
                      {t("database.titleLabel")}
                    </Label>
                    <Input
                      id="note-title"
                      data-testid="note-title"
                      maxLength={200}
                      required
                      value={draft.title}
                      disabled={pending || !draftReady || trash}
                      onChange={(event) =>
                        editDraft({
                          ...editor.draft,
                          title: event.target.value,
                        })
                      }
                      placeholder={t("database.titlePlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex min-h-6 min-w-0 items-center gap-2">
                      <Label htmlFor="note-body" className="shrink-0">
                        {t("database.bodyLabel")}
                      </Label>
                      <p
                        id="note-body-error"
                        role={bodyTooLong ? "alert" : undefined}
                        className="min-w-0 truncate text-xs text-destructive"
                      >
                        {bodyTooLong ? t("data.bodyLimit") : null}
                      </p>
                      {bodyTooLong ? (
                        <HelpTooltip
                          label={`${t("database.bodyLabel")} · ${t("title.help")}`}
                        >
                          {t("data.bodyLimit")}
                        </HelpTooltip>
                      ) : null}
                    </div>
                    <Textarea
                      id="note-body"
                      data-testid="note-body"
                      maxLength={65536}
                      aria-invalid={bodyTooLong}
                      aria-describedby={
                        bodyTooLong ? "note-body-error" : undefined
                      }
                      rows={12}
                      value={draft.body}
                      disabled={pending || !draftReady || trash}
                      onChange={(event) =>
                        editDraft({ ...editor.draft, body: event.target.value })
                      }
                      placeholder={t("database.bodyPlaceholder")}
                    />
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
                    ) : null}
                    <span
                      role="status"
                      className="h-5 min-w-0 flex-1 truncate text-xs text-muted-foreground"
                    >
                      {draftNotice && dirty
                        ? t(
                            draftNotice === "recovered"
                              ? "data.draftRecovered"
                              : "data.draftSaved",
                          )
                        : draft.version
                          ? t("database.version", { version: draft.version })
                          : null}
                    </span>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
              <PlusIcon
                className="size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                {t(search || trash ? "database.noResults" : "database.empty")}
              </p>
              <Button
                disabled={pending || !draftReady}
                onClick={() => select(blank())}
              >
                <PlusIcon />
                {t("database.createNote")}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("database.confirmDelete")}</DialogTitle>
            <DialogDescription>{t("data.trashDescription")}</DialogDescription>
          </DialogHeader>
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
      <Dialog
        open={discardOpen}
        onOpenChange={(open) => {
          if (!pending) setDiscardOpen(open);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("database.discardTitle")}</DialogTitle>
            <DialogDescription>
              {t("database.discardDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDiscardOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                const next = nextDraft.current;
                void discard()
                  .then(() => {
                    if (next) {
                      applyDraft(next);
                      setCreating(next.id === null);
                      if (next.id === null) {
                        setTrash(false);
                        setOffset(0);
                        setSelected(new Set());
                      }
                    }
                    nextDraft.current = null;
                    if (mounted.current) setDiscardOpen(false);
                  })
                  .catch((reason) => changeEditor({ error: reason }));
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

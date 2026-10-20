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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  createNote,
  updateNote,
  deleteNote,
  listNotes,
  onNotesChanged,
  isTauri,
  type Note,
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
export default function Database() {
  const { t, language } = useI18n();
  const latest = useLatestTranslator();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(() => listNotes(search), [search]);
  const { data: notes, error, loading, reload } = useNativeResource(load);
  const {
    draft,
    original,
    pending,
    error: mutationError,
  } = useSyncExternalStore(subscribeEditor, readEditor, readEditor);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const nextDraft = useRef<Draft | null>(null);
  const mounted = useRef(false);
  const dirty = isDirty(draft, original);
  const searchTooLong = utf8Length(query) > 200;
  const bodyTooLong = utf8Length(draft.body) > 65536;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!editor.pending && !isDirty(editor.draft, editor.original))
        applyDraft(blank());
    };
  }, []);
  useEffect(() => {
    if (searchTooLong) return;
    const timeout = setTimeout(() => setSearch(query), 180);
    return () => clearTimeout(timeout);
  }, [query, searchTooLong]);
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
  }
  async function save() {
    if (
      editor.pending ||
      !editor.draft.title.trim() ||
      utf8Length(editor.draft.body) > 65536 ||
      !isDirty(editor.draft, editor.original)
    )
      return;
    const current = editor.draft;
    changeEditor({ pending: true, error: null });
    try {
      const note =
        current.id === null
          ? await createNote({ title: current.title, body: current.body })
          : await updateNote({
              id: current.id,
              title: current.title,
              body: current.body,
              expectedVersion: current.version,
            });
      applyDraft(note);
      if (mounted.current) {
        await reload();
        if (mounted.current) toast.success(latest("database.saved"));
      }
    } catch (reason) {
      changeEditor({ error: reason });
    } finally {
      changeEditor({ pending: false });
    }
  }
  async function remove() {
    if (editor.draft.id === null || editor.pending) return;
    const id = editor.draft.id;
    changeEditor({ pending: true, error: null });
    try {
      await deleteNote(id);
      applyDraft(blank());
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
                  <li key={note.id}>
                    <button
                      type="button"
                      disabled={pending}
                      aria-pressed={draft.id === note.id}
                      onClick={() => editNote(note)}
                      className={cn(
                        "w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted",
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
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4 pt-5">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
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
                  disabled={pending}
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
                <textarea
                  id="note-body"
                  data-testid="note-body"
                  maxLength={65536}
                  aria-invalid={bodyTooLong}
                  aria-describedby={bodyTooLong ? "note-body-error" : undefined}
                  rows={12}
                  value={draft.body}
                  disabled={pending}
                  onChange={(event) =>
                    changeEditor({
                      draft: { ...editor.draft, body: event.target.value },
                    })
                  }
                  placeholder={t("database.bodyPlaceholder")}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
                    pending || !draft.title.trim() || !dirty || bodyTooLong
                  }
                >
                  <SaveIcon />
                  {t("common.save")}
                </Button>
                {draft.id !== null ? (
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
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("database.confirmDelete")}</DialogTitle>
            <DialogDescription>
              {t("database.confirmDeleteDescription")}
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

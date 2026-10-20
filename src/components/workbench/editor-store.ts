import type { WorkbenchDocument } from "@/lib/tauri";

export type WorkbenchEditorEntry = {
  document: WorkbenchDocument;
  draft: string;
  remoteChanged: boolean;
};
type EditorState = {
  entries: WorkbenchEditorEntry[];
  selectedId: string | null;
};

/** 每个 WebView 内保留打开文档与草稿，路由切换不会丢掉编辑。 */
export function createWorkbenchEditor() {
  let state: EditorState = { entries: [], selectedId: null };
  const listeners = new Set<() => void>();
  const emit = (next: EditorState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(documents: WorkbenchDocument[]) {
      const entries = [...state.entries];
      for (const document of documents) {
        const index = entries.findIndex(
          (entry) => entry.document.id === document.id,
        );
        const previous = entries[index];
        if (previous && previous.draft !== (previous.document.content ?? "")) {
          entries[index] = {
            ...previous,
            remoteChanged:
              previous.remoteChanged ||
              previous.document.revision !== document.revision,
          };
        } else {
          const next = {
            document,
            draft: document.content ?? "",
            remoteChanged: false,
          };
          if (index < 0) entries.push(next);
          else entries[index] = next;
        }
      }
      emit({ entries, selectedId: documents[0]?.id ?? state.selectedId });
    },
    select(id: string) {
      emit({ ...state, selectedId: id });
    },
    edit(id: string, draft: string) {
      emit({
        ...state,
        entries: state.entries.map((entry) =>
          entry.document.id === id ? { ...entry, draft } : entry,
        ),
      });
    },
    accept(document: WorkbenchDocument, replaceId = document.id) {
      const entries = state.entries.filter(
        (entry) =>
          entry.document.id !== replaceId && entry.document.id !== document.id,
      );
      entries.push({
        document,
        draft: document.content ?? "",
        remoteChanged: false,
      });
      emit({ entries, selectedId: document.id });
    },
    close(id: string) {
      const entries = state.entries.filter((entry) => entry.document.id !== id);
      emit({
        entries,
        selectedId:
          state.selectedId === id
            ? (entries.at(-1)?.document.id ?? null)
            : state.selectedId,
      });
    },
    hasUnsavedChanges() {
      return state.entries.some(
        (entry) => entry.draft !== (entry.document.content ?? ""),
      );
    },
  };
}
export const workbenchEditor = createWorkbenchEditor();

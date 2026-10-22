import type { Activation, WorkbenchDocument } from "@/lib/tauri";

export type WorkbenchEditorEntry = {
  document: WorkbenchDocument;
  draft: string;
  remoteChanged: boolean;
};
type EditorState = {
  entries: WorkbenchEditorEntry[];
  selectedId: string | null;
  activationErrors: unknown[];
};

/** 每个 WebView 内保留打开文档与草稿，路由切换不会丢掉编辑。 */
export function createWorkbenchEditor() {
  let state: EditorState = {
    entries: [],
    selectedId: null,
    activationErrors: [],
  };
  const listeners = new Set<() => void>();
  const activations = new Map<number, Promise<void>>();
  const completedActivations = new Set<number>();
  const completed = Promise.resolve();
  const resourceActivations = new Map<
    string,
    { id: number; active: boolean }
  >();
  let latestActivation = -1;
  let interaction = 0;
  const emit = (next: EditorState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  function open(documents: WorkbenchDocument[], select = true) {
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
    emit({
      ...state,
      entries,
      selectedId: select
        ? (documents[0]?.id ?? state.selectedId)
        : (state.selectedId ?? documents[0]?.id ?? null),
    });
  }
  function addActivationErrors(errors: unknown[]) {
    if (errors.length)
      emit({
        ...state,
        activationErrors: [...state.activationErrors, ...errors].slice(-20),
      });
  }
  function invalidateResource(id: string) {
    const activation = resourceActivations.get(id);
    if (activation) activation.active = false;
  }
  function completeActivation(id: number) {
    completedActivations.add(id);
    // 与原生按 ID 保留的 20 条历史一致，旧操作晚到不能挤掉新记录。
    const retained = [...completedActivations]
      .sort((a, b) => b - a)
      .slice(0, 20);
    completedActivations.clear();
    retained.forEach((value) => completedActivations.add(value));
    for (const [resourceId, entry] of resourceActivations) {
      if (entry.id === id) entry.active = false;
      if (!activations.has(entry.id) && !completedActivations.has(entry.id))
        resourceActivations.delete(resourceId);
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(documents: WorkbenchDocument[]) {
      interaction++;
      for (const document of documents) invalidateResource(document.id);
      open(documents);
    },
    /** 激活交接属于编辑器生命周期；在途和保留历史中的重复交接只消费一次。 */
    openActivation(
      value: Activation,
      load: (id: string) => Promise<WorkbenchDocument>,
    ): Promise<void> {
      const previous = activations.get(value.id);
      if (previous) return previous;
      latestActivation = Math.max(latestActivation, value.id);
      if (
        completedActivations.has(value.id) ||
        (!value.resourceIds.length && !value.errors.length)
      )
        return completed;
      if (activations.size >= 20) {
        addActivationErrors([...value.errors, { code: "WORKBENCH_BUSY" }]);
        completeActivation(value.id);
        return completed;
      }
      const baseline = interaction;
      const ids = [...new Set(value.resourceIds)];
      for (const id of ids) {
        const previous = resourceActivations.get(id);
        if (!previous || value.id > previous.id)
          resourceActivations.set(id, { id: value.id, active: true });
      }
      addActivationErrors(value.errors);
      const pending = Promise.resolve()
        .then(async () => {
          const documents: WorkbenchDocument[] = [];
          const errors: unknown[] = [];
          // 每次激活顺序读取，最多 20 次激活并行；页面切换不取消已经接收的打开请求。
          for (const id of ids) {
            const current = () => {
              const entry = resourceActivations.get(id);
              return entry?.id === value.id && entry.active;
            };
            if (!current()) continue;
            try {
              const document = await load(id);
              if (current()) documents.push(document);
            } catch (reason) {
              if (current()) errors.push(reason);
            }
          }
          const currentDocuments = documents.filter((document) => {
            const entry = resourceActivations.get(document.id);
            return entry?.id === value.id && entry.active;
          });
          if (currentDocuments.length)
            open(
              currentDocuments,
              value.id === latestActivation && baseline === interaction,
            );
          addActivationErrors(errors);
        })
        .finally(() => {
          activations.delete(value.id);
          completeActivation(value.id);
        });
      activations.set(value.id, pending);
      return pending;
    },
    clearActivationErrors() {
      emit({ ...state, activationErrors: [] });
    },
    select(id: string) {
      interaction++;
      emit({ ...state, selectedId: id });
    },
    edit(id: string, draft: string) {
      interaction++;
      emit({
        ...state,
        entries: state.entries.map((entry) =>
          entry.document.id === id ? { ...entry, draft } : entry,
        ),
      });
    },
    accept(document: WorkbenchDocument, replaceId = document.id) {
      interaction++;
      invalidateResource(document.id);
      invalidateResource(replaceId);
      const entries = state.entries.filter(
        (entry) =>
          entry.document.id !== replaceId && entry.document.id !== document.id,
      );
      entries.push({
        document,
        draft: document.content ?? "",
        remoteChanged: false,
      });
      emit({ ...state, entries, selectedId: document.id });
    },
    close(id: string) {
      interaction++;
      invalidateResource(id);
      const entries = state.entries.filter((entry) => entry.document.id !== id);
      emit({
        ...state,
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

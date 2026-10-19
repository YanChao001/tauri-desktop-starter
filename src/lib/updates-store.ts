import { useSyncExternalStore } from "react";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdateSnapshot,
  onUpdateProgress,
  type UpdateStatus,
  type UpdateProgress,
} from "./tauri";

type Phase =
  | "idle"
  | "checking"
  | "ready"
  | "downloading"
  | "installing"
  | "installed"
  | "error";
type State = {
  phase: Phase;
  operationId: number;
  status: UpdateStatus | null;
  progress: UpdateProgress | null;
  error: unknown;
};
type Backend = {
  check: typeof checkForUpdate;
  install: typeof downloadAndInstallUpdate;
  snapshot: typeof getUpdateSnapshot;
  listen: typeof onUpdateProgress;
};
const STAGES = {
  checking: 0,
  checked: 1,
  downloading: 2,
  installing: 3,
  installed: 4,
  failed: 4,
};
const running = (phase: Phase) =>
  phase === "checking" || phase === "downloading" || phase === "installing";
const finite = (value: number | null, positive = false) =>
  value !== null && Number.isFinite(value) && value >= (positive ? 1 : 0)
    ? value
    : null;

/** One store per WebView; operation ids also reconcile broadcasts from other windows. */
export function createUpdatesStore(backend: Backend) {
  let state: State = {
    phase: "idle",
    operationId: 0,
    status: null,
    progress: null,
    error: null,
  };
  let request = false;
  let stage: keyof typeof STAGES | null = null;
  const listeners = new Set<() => void>();
  const getSnapshot = () => state;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  function update(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function accept(value: UpdateProgress) {
    if (
      !Number.isSafeInteger(value.operationId) ||
      value.operationId < 1 ||
      state.phase === "installed"
    )
      return;
    if (
      value.operationId < state.operationId ||
      !Object.hasOwn(STAGES, value.stage)
    )
      return;
    const same = value.operationId === state.operationId;
    if (
      same &&
      stage &&
      (stage === "installed" ||
        stage === "failed" ||
        STAGES[value.stage] < STAGES[stage])
    )
      return;
    let downloaded = finite(value.downloaded);
    let total = finite(value.total, true);
    if (same && value.stage === "downloading" && stage === "downloading") {
      downloaded = Math.max(downloaded ?? 0, state.progress?.downloaded ?? 0);
      total ??= state.progress?.total ?? null;
    }
    const progress = { ...value, downloaded, total };
    const common = { operationId: value.operationId, progress };
    stage = value.stage;
    switch (value.stage) {
      case "checking":
        update({ ...common, phase: "checking", status: null, error: null });
        break;
      case "checked":
        update({
          ...common,
          phase: "ready",
          status: value.status,
          error: null,
        });
        break;
      case "downloading":
      case "installing":
        update({ ...common, phase: value.stage, error: null });
        break;
      case "installed":
        update({ ...common, phase: "installed", error: null });
        break;
      case "failed":
        update({
          ...common,
          phase: "error",
          status: null,
          error: value.error ?? new Error("Update operation failed"),
        });
        break;
    }
  }

  async function checkUpdates() {
    if (request || running(state.phase) || state.phase === "installed") return;
    request = true;
    const operationId = state.operationId;
    update({ phase: "checking", status: null, progress: null, error: null });
    try {
      const status = await backend.check();
      accept({
        operationId: status.operationId,
        stage: "checked",
        downloaded: null,
        total: null,
        status,
        error: null,
      });
    } catch (error) {
      // Once a newer operation has broadcast, its terminal event owns the state.
      if (state.operationId === operationId)
        update({ phase: "error", status: null, error });
    } finally {
      request = false;
    }
  }

  async function installUpdate() {
    if (
      request ||
      state.phase !== "ready" ||
      !state.status?.configured ||
      !state.status.available
    )
      return;
    request = true;
    const operationId = state.operationId;
    update({ phase: "downloading", progress: null, error: null });
    try {
      await backend.install();
      update({ phase: "installed", error: null });
    } catch (error) {
      if (state.operationId === operationId)
        update({ phase: "error", status: null, progress: null, error });
    } finally {
      request = false;
    }
  }

  async function attachUpdateEvents() {
    let stopped = false;
    const stop = await backend.listen((value) => {
      if (!stopped) accept(value);
    });
    // Subscribe first, then hydrate; older snapshots cannot overwrite newer events.
    void backend
      .snapshot()
      .then((value) => {
        if (!stopped && value) accept(value);
      })
      .catch((error: unknown) => {
        if (!stopped && state.phase === "idle")
          update({ phase: "error", error });
      });
    return () => {
      if (!stopped) {
        stopped = true;
        stop();
      }
    };
  }

  return {
    getSnapshot,
    subscribe,
    checkUpdates,
    installUpdate,
    attachUpdateEvents,
  };
}

const store = createUpdatesStore({
  check: checkForUpdate,
  install: downloadAndInstallUpdate,
  snapshot: getUpdateSnapshot,
  listen: onUpdateProgress,
});
export const checkUpdates = store.checkUpdates;
export const installUpdate = store.installUpdate;
export const attachUpdateEvents = store.attachUpdateEvents;
export function useUpdates() {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

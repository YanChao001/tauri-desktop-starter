import type { ExtensionView } from "@/lib/tauri";

export type ExtensionSessionState = {
  identity: string;
  /** Importing a snapshot does not execute a locale refresh. */
  locale?: string;
  uiState?: string | null;
  view: ExtensionView | null;
  fields: Record<string, string>;
  dirty: boolean;
  pending: Promise<void> | null;
  exporting: Promise<void> | null;
  selecting: Promise<void> | null;
  error: unknown;
  draft: {
    inputText: string;
    url: string;
    files: { id: string; name: string }[];
  };
};
export type ExtensionSession = {
  getSnapshot: () => ExtensionSessionState;
  subscribe: (listener: () => void) => () => void;
  update: (patch: Partial<ExtensionSessionState>) => void;
};

export const EXTENSION_SESSION_CACHE_COUNT = 12;
export const EXTENSION_SESSION_CACHE_BYTES = 32 * 1024 * 1024;

export function createExtensionSession(
  identity: string,
  changed: () => void = () => {},
): ExtensionSession {
  let state: ExtensionSessionState = {
    identity,
    uiState: null,
    view: null,
    fields: {},
    dirty: false,
    pending: null,
    exporting: null,
    selecting: null,
    error: null,
    draft: { inputText: "", url: "", files: [] },
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (patch) => {
      state = { ...state, ...patch };
      changed();
      listeners.forEach((listener) => listener());
    },
  };
}

const PAYLOAD_KEYS = [
  "identity",
  "locale",
  "uiState",
  "view",
  "fields",
  "draft",
] as const;
type CacheEntry = {
  key: string;
  session: ExtensionSession;
  active: number;
  used: number;
  retired: boolean;
  bytes: number;
  parts: Map<(typeof PAYLOAD_KEYS)[number], { value: unknown; bytes: number }>;
};

/** Budgets apply to idle clean sessions; active, dirty and in-flight work is never evicted. */
export class ExtensionSessionCache {
  readonly sessions = new Map<string, ExtensionSession>();
  private entries = new Map<ExtensionSession, CacheEntry>();
  private known = new WeakMap<ExtensionSession, CacheEntry>();
  private clock = 0;
  private bytes = 0;
  private scheduled = false;

  constructor(
    private maxCount = EXTENSION_SESSION_CACHE_COUNT,
    private maxBytes = EXTENSION_SESSION_CACHE_BYTES,
  ) {}

  getOrCreate(key: string, identity: string): ExtensionSession {
    const previous = this.sessions.get(key);
    if (previous?.getSnapshot().identity === identity) return previous;
    if (previous) {
      const old = this.entries.get(previous);
      if (old) old.retired = true;
    }
    const session = createExtensionSession(identity, () => {
      const entry = this.entries.get(session);
      if (entry) this.measure(entry);
      this.scheduleTrim();
    });
    const entry: CacheEntry = {
      key,
      session,
      active: 0,
      used: ++this.clock,
      retired: false,
      bytes: 0,
      parts: new Map(),
    };
    this.sessions.set(key, session);
    this.entries.set(session, entry);
    this.known.set(session, entry);
    this.measure(entry);
    return session;
  }

  retain(session: ExtensionSession): () => void {
    const entry = this.known.get(session);
    if (!entry) return () => {};
    // A concurrent render can commit after an idle-cache trim. Pin its original
    // instance rather than leaving the mounted view detached from the cache.
    if (!this.entries.has(session)) {
      this.entries.set(session, entry);
      this.bytes += entry.bytes;
      this.measure(entry);
      if (!entry.retired) {
        const previous = this.sessions.get(entry.key);
        const old = previous && this.entries.get(previous);
        if (old) old.retired = true;
        this.sessions.set(entry.key, session);
      }
    }
    entry.active++;
    entry.used = ++this.clock;
    this.scheduleTrim();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.active--;
      entry.used = ++this.clock;
      // StrictMode immediately reacquires the same session before this microtask.
      this.scheduleTrim();
    };
  }

  reconcile(valid: (key: string, state: ExtensionSessionState) => boolean) {
    for (const entry of this.entries.values()) {
      if (!valid(entry.key, entry.session.getSnapshot())) {
        entry.retired = true;
        if (this.sessions.get(entry.key) === entry.session)
          this.sessions.delete(entry.key);
      }
    }
    this.scheduleTrim();
  }

  private measure(entry: CacheEntry) {
    const state = entry.session.getSnapshot();
    for (const key of PAYLOAD_KEYS) {
      const value = state[key];
      const previous = entry.parts.get(key);
      if (previous && Object.is(previous.value, value)) continue;
      // Re-encoding a small field edit must not encode an unchanged large view.
      const bytes = new TextEncoder().encode(
        JSON.stringify(value) ?? "",
      ).length;
      const delta = bytes - (previous?.bytes ?? 0);
      this.bytes += delta;
      entry.bytes += delta;
      entry.parts.set(key, { value, bytes });
    }
  }

  private scheduleTrim() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const candidates = [...this.entries.values()]
        .filter((entry) => {
          const state = entry.session.getSnapshot();
          return (
            !entry.active &&
            !state.dirty &&
            !state.pending &&
            !state.exporting &&
            !state.selecting
          );
        })
        .sort((a, b) => a.used - b.used);
      for (const entry of candidates) {
        if (
          !entry.retired &&
          this.entries.size <= this.maxCount &&
          this.bytes <= this.maxBytes
        )
          continue;
        this.entries.delete(entry.session);
        this.bytes -= entry.bytes;
        if (this.sessions.get(entry.key) === entry.session)
          this.sessions.delete(entry.key);
      }
    });
  }
}

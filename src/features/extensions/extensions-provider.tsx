import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  extensionSnapshot,
  isTauri,
  onExtensionsChanged,
  type ExtensionSnapshot,
  type ExtensionView,
} from "@/lib/tauri";

import { extensionInstallationIdentity } from "./extension-model";

export type ExtensionSession = {
  identity: string;
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
type ExtensionsContext = {
  data: ExtensionSnapshot | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
  sessions: Map<string, ExtensionSession>;
};
const Context = createContext<ExtensionsContext | null>(null);

/** One snapshot subscription per host window; sessions stay in this window's memory. */
export function ExtensionsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ExtensionSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(isTauri);
  const sessions = useRef(new Map<string, ExtensionSession>());
  const generation = useRef(0);
  const alive = useRef(false);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const reload = useCallback(async () => {
    if (!isTauri()) return;
    const request = ++generation.current;
    try {
      const snapshot = await extensionSnapshot();
      if (alive.current && request === generation.current) {
        for (const [key, session] of sessions.current) {
          const extensionId = key.split(":")[0];
          if (
            !snapshot.items.some(
              (item) =>
                item.package.manifest.id === extensionId &&
                extensionInstallationIdentity(item) === session.identity,
            )
          )
            sessions.current.delete(key);
        }
        setData(snapshot);
        setError(null);
      }
    } catch (reason) {
      if (alive.current && request === generation.current) {
        // 刷新失败保留会话所在的最后成功快照；原生调用仍重新校验权限与包身份。
        setError(reason);
      }
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    if (isTauri())
      void onExtensionsChanged(() => {
        if (!stopped) void reload();
      })
        .then((stop) => {
          if (stopped) stop();
          else {
            unsubscribe = stop;
            void reload();
          }
        })
        .catch((reason: unknown) => {
          if (!stopped) {
            setError(reason);
            setLoading(false);
          }
        });
    return () => {
      stopped = true;
      alive.current = false;
      invalidate();
      unsubscribe?.();
    };
  }, [reload, invalidate]);
  const value = useMemo(
    () => ({ data, error, loading, reload, sessions: sessions.current }),
    [data, error, loading, reload],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useExtensions() {
  const value = useContext(Context);
  if (!value) throw new Error("ExtensionsProvider is required");
  return value;
}

export function useExtensionSession(key: string, identity: string) {
  const context = useContext(Context);
  const [session] = useState<ExtensionSession>(() => {
    const previous = context?.sessions.get(key);
    if (previous?.identity === identity) return previous;
    const next: ExtensionSession = {
      identity,
      view: null,
      fields: {},
      dirty: false,
      pending: null,
      exporting: null,
      selecting: null,
      error: null,
      draft: { inputText: "", url: "", files: [] },
    };
    context?.sessions.set(key, next);
    return next;
  });
  return session;
}

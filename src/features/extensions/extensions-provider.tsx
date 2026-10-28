import { ExtensionsContext as Context } from "./extensions-context";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useI18n } from "@/providers/i18n";
import { nativeErrorText } from "@/lib/native-error";
import {
  extensionSnapshot,
  prepareEnabledExtensions,
  isTauri,
  onExtensionsChanged,
  type ExtensionSnapshot,
} from "@/lib/tauri";

import { extensionInstallationIdentity } from "./extension-model";
import {
  createExtensionSession,
  ExtensionSessionCache,
  type ExtensionSession,
} from "./extension-session-cache";

/** One snapshot subscription per host window; sessions stay in this window's memory. */
export function ExtensionsProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const translate = useRef(t);
  useLayoutEffect(() => {
    translate.current = t;
  }, [t]);
  const [data, setData] = useState<ExtensionSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(isTauri);
  const [sessionCache] = useState(() => new ExtensionSessionCache());
  const generation = useRef(0);
  const alive = useRef(false);
  const startupChecked = useRef(false);
  const prepare = useCallback(async function prepareStartup(): Promise<void> {
    if (!alive.current) return;
    try {
      await prepareEnabledExtensions();
      if (alive.current) toast.dismiss("extension-startup-preparation");
    } catch (reason) {
      if (!alive.current) return;
      const t = translate.current;
      toast.error(nativeErrorText(reason, t), {
        id: "extension-startup-preparation",
        description: t("ext.prepareFailedDescription"),
        action: {
          label: t("common.retry"),
          onClick: () => void prepareStartup(),
        },
      });
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const reload = useCallback(async () => {
    if (!isTauri()) return;
    const request = ++generation.current;
    try {
      const snapshot = await extensionSnapshot();
      if (alive.current && request === generation.current) {
        sessionCache.reconcile((key, state) => {
          const extensionId = key.split(":")[0];
          return snapshot.items.some(
            (item) =>
              item.package.manifest.id === extensionId &&
              extensionInstallationIdentity(item) === state.identity,
          );
        });
        setData(snapshot);
        setError(null);
        if (!startupChecked.current) {
          startupChecked.current = true;
          // 只准备启动时已有的插件；不等待编译，不因运行阶段刷新重复启动。
          if (snapshot.items.some((item) => item.enabled)) void prepare();
        }
      }
    } catch (reason) {
      if (alive.current && request === generation.current) {
        // 刷新失败保留会话所在的最后成功快照；原生调用仍重新校验权限与包身份。
        setError(reason);
      }
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, [sessionCache, prepare]);
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
    () => ({
      data,
      error,
      loading,
      reload,
      sessions: sessionCache.sessions,
      sessionCache,
    }),
    [data, error, loading, reload, sessionCache],
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
  const cache = context?.sessionCache;
  const [session] = useState<ExtensionSession>(
    () => cache?.getOrCreate(key, identity) ?? createExtensionSession(identity),
  );
  useLayoutEffect(() => cache?.retain(session), [cache, session]);
  return session;
}

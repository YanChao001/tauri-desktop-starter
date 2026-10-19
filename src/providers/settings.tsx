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
  applySettings,
  DEFAULT_SETTINGS,
  normalizeSettingsPatch,
  readInitialSettings,
  settingsDocument,
  STORAGE_KEY,
  type AppSettings,
} from "@/lib/settings-model";
import { SettingsSync, type PersistenceStatus } from "@/lib/settings-sync";
import * as desktop from "@/lib/tauri";

export * from "@/lib/settings-model";
type SettingsContextValue = {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
  persistence: PersistenceStatus;
  persistenceError: string | null;
  retrySave: () => void;
};
const SettingsContext = createContext<SettingsContextValue | null>(null);
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readInitialSettings);
  const [settings, setSettings] = useState(initial.settings);
  const [persistence, setPersistence] = useState<PersistenceStatus>(
    initial.error ? "error" : "loading",
  );
  const [persistenceError, setPersistenceError] = useState(initial.error);
  const [retry, setRetry] = useState(0);
  const current = useRef(settings);
  const sync = useRef<SettingsSync | null>(null);
  const unsaved = useRef<Partial<AppSettings>>({});
  const futureVersion = useRef(initial.error === "FUTURE_SETTINGS_VERSION");
  const native = desktop.isTauri();
  useEffect(() => {
    if (!native) return;
    const coordinator = new SettingsSync(
      current.current,
      {
        load: desktop.loadSettingsSnapshot,
        save: desktop.saveSettingsSnapshot,
        subscribe: desktop.onSettingsChanged,
      },
      (state) => {
        if (state.error === "FUTURE_SETTINGS_VERSION")
          futureVersion.current = true;
        current.current = state.settings;
        setSettings(state.settings);
        setPersistence(state.status);
        setPersistenceError(state.error);
      },
    );
    sync.current = coordinator;
    coordinator.update(unsaved.current);
    void coordinator.start();
    return () => {
      unsaved.current = coordinator.stop();
      sync.current = null;
    };
  }, [native]);
  useEffect(() => {
    applySettings(settings);
    if (futureVersion.current) return;
    if (native) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(settingsDocument(settings)),
        );
      } catch {
        /* 原生存储仍可用 */
      }
      return;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(settingsDocument(settings)),
      );
      setPersistence("saved");
      setPersistenceError(null);
    } catch {
      setPersistence("error");
      setPersistenceError("STORAGE_UNAVAILABLE");
    }
  }, [settings, retry, native]);
  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      const normalized = normalizeSettingsPatch(current.current, patch);
      if (sync.current) sync.current.update(normalized);
      else {
        if (native) unsaved.current = { ...unsaved.current, ...normalized };
        const next = { ...current.current, ...normalized };
        current.current = next;
        setSettings(next);
      }
    },
    [native],
  );
  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS, language: current.current.language };
    futureVersion.current = false;
    if (sync.current) sync.current.reset(next);
    else {
      unsaved.current = next;
      current.current = next;
      setSettings(next);
    }
  }, []);
  const retrySave = useCallback(() => {
    if (sync.current) void sync.current.retry();
    else setRetry((value) => value + 1);
  }, []);
  const value = useMemo(
    () => ({
      settings,
      update,
      reset,
      persistence,
      persistenceError,
      retrySave,
    }),
    [settings, update, reset, persistence, persistenceError, retrySave],
  );
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error("useSettings must be used within SettingsProvider");
  return context;
}

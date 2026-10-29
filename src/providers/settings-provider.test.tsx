import { StrictMode, useLayoutEffect, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as desktop from "@/lib/tauri";
import {
  DEFAULT_SETTINGS,
  settingsDocument,
  STORAGE_KEY,
  SETTINGS_VERSION,
  type AppSettings,
} from "@/lib/settings-model";
import { SettingsProvider, useSettings } from "./settings";

vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => false),
  loadSettingsSnapshot: vi.fn(),
  saveSettingsSnapshot: vi.fn(),
  resetSettingsSnapshot: vi.fn(),
  onSettingsChanged: vi.fn(),
}));
const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("settings provider persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    vi.mocked(desktop.isTauri).mockReturnValue(false);
    vi.mocked(desktop.onSettingsChanged).mockReset();
    vi.mocked(desktop.loadSettingsSnapshot).mockReset();
    vi.mocked(desktop.saveSettingsSnapshot).mockReset();
    vi.mocked(desktop.resetSettingsSnapshot).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("保存启动位置偏好，重新挂载时恢复，重置时回到记住上次位置", async () => {
    const first = renderHook(useSettings, { wrapper });
    act(() => first.result.current.update({ windowPosition: "center" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      windowPosition: "center",
    });
    first.unmount();
    const next = renderHook(useSettings, { wrapper });
    expect(next.result.current.settings.windowPosition).toBe("center");
    await act(async () => next.result.current.reset());
    expect(next.result.current.settings.windowPosition).toBe("remember");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      windowPosition: "remember",
    });
  });

  it("keeps a future browser schema intact through edits and retries until reset", async () => {
    const raw = JSON.stringify({ schemaVersion: 99, unknown: "preserved" });
    localStorage.setItem(STORAGE_KEY, raw);
    const { result } = renderHook(useSettings, { wrapper });
    act(() => result.current.update({ language: "en", accent: "rose" }));
    act(() => result.current.retrySave());
    expect(result.current.settings).toMatchObject({
      language: "en",
      accent: "rose",
    });
    expect(result.current).toMatchObject({
      persistence: "error",
      persistenceError: "FUTURE_SETTINGS_VERSION",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    await act(async () => result.current.reset());
    expect(result.current.settings).toEqual({
      ...DEFAULT_SETTINGS,
      language: "en",
    });
    expect(result.current.persistence).toBe("saved");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(
      settingsDocument({ ...DEFAULT_SETTINGS, language: "en" }),
    );
  });

  it("retains consecutive local edits after storage fails and saves them on retry", () => {
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const { result } = renderHook(useSettings, { wrapper });
    act(() => {
      result.current.update({ accent: "rose" });
      result.current.update({ font: "mono" });
    });
    expect(result.current.settings).toMatchObject({
      accent: "rose",
      font: "mono",
    });
    expect(result.current).toMatchObject({
      persistence: "error",
      persistenceError: "STORAGE_UNAVAILABLE",
    });
    write.mockRestore();
    act(() => result.current.retrySave());
    expect(result.current.persistence).toBe("saved");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      accent: "rose",
      font: "mono",
    });
  });

  it("preserves unreadable browser settings until an explicit reset", async () => {
    const raw = '{"schemaVersion":3,"accent":';
    localStorage.setItem(STORAGE_KEY, raw);
    const { result } = renderHook(useSettings, { wrapper });
    act(() => result.current.update({ language: "en", accent: "rose" }));
    act(() => result.current.retrySave());
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(result.current).toMatchObject({
      persistence: "error",
      persistenceError: "STORAGE_UNAVAILABLE",
      settings: { language: "en", accent: "rose" },
    });
    await act(async () => result.current.reset());
    expect(result.current.persistence).toBe("saved");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(
      settingsDocument({ ...DEFAULT_SETTINGS, language: "en" }),
    );
  });

  it.each(["", "null", "[]", '"preferences"', "true", "123"])(
    "保留结构损坏的浏览器存档 %j，直到显式重置",
    async (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      const { result } = renderHook(useSettings, { wrapper });
      act(() => result.current.update({ language: "en", accent: "rose" }));
      act(() => result.current.retrySave());
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
      expect(result.current).toMatchObject({
        persistence: "error",
        persistenceError: "STORAGE_UNAVAILABLE",
        settings: { language: "en", accent: "rose" },
      });
      await act(async () => result.current.reset());
      expect(result.current.persistence).toBe("saved");
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(
        settingsDocument({ ...DEFAULT_SETTINGS, language: "en" }),
      );
    },
  );

  it("reloads after a browser read failure and merges only edits made while unavailable", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(settingsDocument({ ...DEFAULT_SETTINGS, theme: "dark" })),
    );
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    const write = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(useSettings, { wrapper });
    act(() => result.current.update({ accent: "rose" }));
    expect(write).not.toHaveBeenCalled();
    read.mockRestore();
    act(() => result.current.retrySave());
    expect(result.current).toMatchObject({
      persistence: "saved",
      persistenceError: null,
      settings: { theme: "dark", accent: "rose" },
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      theme: "dark",
      accent: "rose",
    });
  });

  it("normalizes browser patches without accepting unknown keys or losing other fields", () => {
    const { result } = renderHook(useSettings, { wrapper });
    act(() => result.current.update({ theme: "dark", accent: "rose" }));
    act(() =>
      result.current.update({
        schemaVersion: 99,
        sidebarWidth: 999,
        accent: "pink",
      } as unknown as Partial<AppSettings>),
    );
    expect(result.current.settings).toMatchObject({
      theme: "dark",
      sidebarWidth: 360,
      accent: DEFAULT_SETTINGS.accent,
    });
    expect(result.current.settings).not.toHaveProperty("schemaVersion");
  });

  it("keeps early local changes through StrictMode setup replay and the initial native load", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    const loading = deferred<desktop.SettingsSnapshot>();
    const stop = vi.fn();
    vi.mocked(desktop.onSettingsChanged).mockResolvedValue(stop);
    vi.mocked(desktop.loadSettingsSnapshot).mockReturnValue(loading.promise);
    vi.mocked(desktop.saveSettingsSnapshot).mockImplementation(
      async (settings) => ({
        revision: 2,
        settings: settings as desktop.SettingsSnapshot["settings"],
      }),
    );
    const strict = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <SettingsProvider>{children}</SettingsProvider>
      </StrictMode>
    );
    const { result, unmount } = renderHook(
      () => {
        const settings = useSettings();
        const { update } = settings;
        useLayoutEffect(() => {
          update({ accent: "rose" });
          update({ font: "mono" });
        }, [update]);
        return settings;
      },
      { wrapper: strict },
    );
    await act(async () =>
      loading.resolve({
        revision: 1,
        settings: settingsDocument({ ...DEFAULT_SETTINGS, theme: "dark" }),
      }),
    );
    await waitFor(() => expect(result.current.persistence).toBe("saved"));
    expect(result.current.settings).toMatchObject({
      accent: "rose",
      font: "mono",
      theme: "dark",
    });
    expect(desktop.saveSettingsSnapshot).toHaveBeenCalledExactlyOnceWith(
      settingsDocument({
        ...DEFAULT_SETTINGS,
        accent: "rose",
        font: "mono",
        theme: "dark",
      }),
      1,
    );
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("keeps native future schemas blocked and normalizes edits until an explicit reset", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.onSettingsChanged).mockResolvedValue(vi.fn());
    vi.mocked(desktop.loadSettingsSnapshot).mockResolvedValue({
      revision: 5,
      settings: { schemaVersion: 99 },
    });
    vi.mocked(desktop.resetSettingsSnapshot).mockImplementation(
      async (settings) => ({
        revision: 6,
        settings: settings as desktop.SettingsSnapshot["settings"],
      }),
    );
    const { result } = renderHook(useSettings, { wrapper });
    await waitFor(() =>
      expect(result.current.persistenceError).toBe("FUTURE_SETTINGS_VERSION"),
    );
    const cached = localStorage.getItem(STORAGE_KEY);
    act(() =>
      result.current.update({
        language: "en",
        sidebarWidth: -999,
        appMode: "bad",
      } as unknown as Partial<AppSettings>),
    );
    expect(result.current.settings).toMatchObject({
      language: "en",
      sidebarWidth: 180,
      appMode: DEFAULT_SETTINGS.appMode,
    });
    expect(result.current.persistence).toBe("error");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(cached);
    expect(desktop.saveSettingsSnapshot).not.toHaveBeenCalled();
    await act(async () => result.current.reset());
    await waitFor(() => expect(result.current.persistence).toBe("saved"));
    expect(desktop.saveSettingsSnapshot).not.toHaveBeenCalled();
    expect(desktop.resetSettingsSnapshot).toHaveBeenCalledExactlyOnceWith(
      settingsDocument({ ...DEFAULT_SETTINGS, language: "en" }),
      5,
    );
    expect(result.current.settings).toEqual({
      ...DEFAULT_SETTINGS,
      language: "en",
    });
  });

  it("keeps future-version caches protected after a reset fails until a later reset succeeds", async () => {
    const futureCache = JSON.stringify({
      schemaVersion: 99,
      future: "preserve",
    });
    localStorage.setItem(STORAGE_KEY, futureCache);
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.onSettingsChanged).mockResolvedValue(vi.fn());
    vi.mocked(desktop.loadSettingsSnapshot).mockResolvedValue({
      revision: 5,
      settings: { schemaVersion: 99 },
    });
    vi.mocked(desktop.resetSettingsSnapshot)
      .mockRejectedValueOnce({ code: "STORAGE_IO" })
      .mockImplementation(async (settings) => ({ revision: 6, settings }));
    const { result } = renderHook(useSettings, { wrapper });
    await waitFor(() =>
      expect(result.current.persistenceError).toBe("FUTURE_SETTINGS_VERSION"),
    );
    await act(async () => {
      await expect(result.current.reset()).rejects.toEqual({
        code: "STORAGE_IO",
      });
    });
    act(() => result.current.update({ language: "en" }));
    expect(result.current.persistence).toBe("error");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(futureCache);
    expect(desktop.resetSettingsSnapshot).toHaveBeenCalledOnce();
    await act(async () => result.current.reset());
    await waitFor(() => expect(result.current.persistence).toBe("saved"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      language: "en",
      schemaVersion: SETTINGS_VERSION,
    });
  });

  it("accepts native revisions without overwriting the theme transition's old DOM frame", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    let receive: ((snapshot: desktop.SettingsSnapshot) => void) | undefined;
    vi.mocked(desktop.onSettingsChanged).mockImplementation(async (handler) => {
      receive = handler;
      return vi.fn<() => void>();
    });
    vi.mocked(desktop.loadSettingsSnapshot).mockResolvedValue({
      revision: 1,
      settings: settingsDocument({ ...DEFAULT_SETTINGS, theme: "light" }),
    });
    const root = document.documentElement;
    root.classList.remove("dark");
    root.classList.add("light");
    root.style.colorScheme = "light";
    const { result } = renderHook(useSettings, { wrapper });
    await waitFor(() => expect(result.current.persistence).toBe("saved"));
    act(() =>
      receive?.({
        revision: 2,
        settings: settingsDocument({
          ...DEFAULT_SETTINGS,
          theme: "dark",
          accent: "rose",
        }),
      }),
    );
    expect(result.current.settings.theme).toBe("dark");
    expect(root).toHaveClass("light");
    expect(root).not.toHaveClass("dark");
    expect(root.style.colorScheme).toBe("light");
    expect(root.dataset.accent).toBe("rose");
    act(() =>
      receive?.({
        revision: 1,
        settings: settingsDocument({ ...DEFAULT_SETTINGS, theme: "light" }),
      }),
    );
    expect(result.current.settings.theme).toBe("dark");
    expect(desktop.saveSettingsSnapshot).not.toHaveBeenCalled();
  });
});

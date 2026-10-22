import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readInitialSettings,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./settings-model";
import {
  listWallpaperLibrary,
  onWallpaperLibraryChanged,
} from "./wallpaper-library";

vi.mock("@/config/app", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/app")>();
  return {
    ...original,
    APP_CONFIG: {
      ...original.APP_CONFIG,
      browserStorageNamespace: "com.example.migrated",
    },
  };
});
vi.mock("@/lib/tauri", () => ({ isTauri: () => false }));

describe("derived applications sharing a browser origin", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("does not inherit the template's preferences or shared legacy theme", () => {
    localStorage.setItem(
      "tauri-starter:settings",
      JSON.stringify({ accent: "rose", theme: "dark" }),
    );
    localStorage.setItem("theme", "dark");
    expect(readInitialSettings().settings).toMatchObject({
      accent: "neutral",
      theme: "system",
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accent: "blue" }));
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readInitialSettings().settings).toMatchObject({
      accent: "blue",
      theme: "light",
    });
    expect(JSON.parse(localStorage.getItem("tauri-starter:settings")!)).toEqual(
      { accent: "rose", theme: "dark" },
    );
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("keeps the settings document authoritative over the namespaced theme cache", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "dark" }));
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readInitialSettings().settings.theme).toBe("dark");
  });

  it("opens only its own wallpaper database and notification channel", async () => {
    const open = vi.fn(() => {
      throw new Error("Database unavailable in this test");
    });
    vi.stubGlobal("indexedDB", { open });
    const close = vi.fn();
    const names: string[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor(name: string) {
          names.push(name);
        }
        close = close;
        onmessage: (() => void) | null = null;
      },
    );
    await expect(listWallpaperLibrary(null)).rejects.toThrow();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "com.example.migrated:wallpapers",
      1,
    );
    const stop = await onWallpaperLibraryChanged(vi.fn());
    expect(names).toEqual(["com.example.migrated:wallpapers-changed"]);
    stop();
    expect(close).toHaveBeenCalledOnce();
  });
});

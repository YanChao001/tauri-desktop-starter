import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  normalizeSettingsPatch,
  readInitialSettings,
  SETTINGS_VERSION,
  settingsDocument,
  SettingsVersionError,
  STORAGE_KEY,
  type AppSettings,
} from "./settings-model";

describe("versioned settings model", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("migrates legacy flat and v1 wrapped documents to the current complete shape", () => {
    expect(migrateSettings({ language: "en", background: "gradient" })).toEqual(
      { ...DEFAULT_SETTINGS, language: "en", background: "cloudscape" },
    );
    expect(
      migrateSettings({
        schemaVersion: 1,
        settings: { font: "mono", theme: "dark", sidebarWidth: 300 },
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      font: "mono",
      theme: "dark",
      sidebarWidth: 300,
    });
    expect(migrateSettings(settingsDocument(DEFAULT_SETTINGS))).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(settingsDocument(DEFAULT_SETTINGS).schemaVersion).toBe(
      SETTINGS_VERSION,
    );
  });

  it.each([null, [], "invalid", 5, { settings: [] }])(
    "normalizes malformed document %j",
    (raw) => {
      expect(migrateSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it("clamps finite sidebar widths and rejects invalid enums and boolean coercion", () => {
    expect(migrateSettings({ sidebarWidth: 180.8 }).sidebarWidth).toBe(181);
    expect(migrateSettings({ sidebarWidth: -1 }).sidebarWidth).toBe(180);
    expect(migrateSettings({ sidebarWidth: 999 }).sidebarWidth).toBe(360);
    for (const sidebarWidth of [NaN, Infinity, -Infinity, "300", null])
      expect(migrateSettings({ sidebarWidth }).sidebarWidth).toBe(224);
    expect(
      migrateSettings({
        theme: "pink",
        appMode: "unknown",
        sidebarCollapsed: "true",
        runInBackground: 1,
        menuBar: "false",
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects future schemas and preserves their exact stored document", () => {
    const raw = JSON.stringify({
      schemaVersion: SETTINGS_VERSION + 1,
      feature: { new: true },
    });
    localStorage.setItem(STORAGE_KEY, raw);
    expect(() => migrateSettings(JSON.parse(raw))).toThrow(
      SettingsVersionError,
    );
    expect(readInitialSettings()).toEqual({
      settings: DEFAULT_SETTINGS,
      error: "FUTURE_SETTINGS_VERSION",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it("兼容旧存档并仅接受已知的启动位置偏好", () => {
    expect(migrateSettings({}).windowPosition).toBe("remember");
    expect(
      migrateSettings({
        schemaVersion: 1,
        settings: { windowPosition: "center" },
      }).windowPosition,
    ).toBe("center");
    expect(migrateSettings({ windowPosition: "center" }).windowPosition).toBe(
      "center",
    );
    for (const windowPosition of ["top-left", true, null, 1]) {
      expect(migrateSettings({ windowPosition }).windowPosition).toBe(
        "remember",
      );
    }
    expect(
      normalizeSettingsPatch(DEFAULT_SETTINGS, { windowPosition: "center" }),
    ).toEqual({ windowPosition: "center" });
  });

  it("migrates the old theme key only when no explicit theme exists in the document source", () => {
    localStorage.setItem("theme", "dark");
    expect(readInitialSettings().settings.theme).toBe("dark");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, settings: { theme: "light" } }),
    );
    expect(readInitialSettings().settings.theme).toBe("light");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "invalid" }));
    expect(readInitialSettings().settings.theme).toBe("system");
  });

  it("reports read failures without throwing and retains the detected language", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readInitialSettings()).toEqual({
      settings: { ...DEFAULT_SETTINGS, language: "en" },
      error: "STORAGE_UNAVAILABLE",
    });
  });

  it("normalizes only supplied settings fields and drops unknown runtime keys", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      theme: "dark" as const,
      font: "mono" as const,
    };
    const unsafe = {
      schemaVersion: 999,
      sidebarWidth: 999,
      language: "bad",
      accent: "pink",
      unexpected: true,
    } as unknown as Partial<AppSettings>;
    const patch = normalizeSettingsPatch(current, unsafe);
    expect(patch).toEqual({
      sidebarWidth: 360,
      language: "zh",
      accent: "neutral",
    });
    expect({ ...current, ...patch }).toMatchObject({
      theme: "dark",
      font: "mono",
    });
    expect(
      normalizeSettingsPatch(current, null as unknown as Partial<AppSettings>),
    ).toEqual({});
  });
});

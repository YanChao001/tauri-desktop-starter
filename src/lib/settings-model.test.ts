import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySettings,
  DEFAULT_SETTINGS,
  loadSettings,
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
  it("defaults legacy startup update checks on and preserves an explicit opt-out", () => {
    expect(
      migrateSettings({ schemaVersion: 3, language: "en" }).autoCheckUpdates,
    ).toBe(true);
    expect(
      migrateSettings({ schemaVersion: 3, autoCheckUpdates: false })
        .autoCheckUpdates,
    ).toBe(false);
    expect(
      normalizeSettingsPatch(DEFAULT_SETTINGS, { autoCheckUpdates: false }),
    ).toEqual({ autoCheckUpdates: false });
  });

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

  it("schema 2 升级保留偏好，导入图片随 schema 3 存档并可移除", () => {
    const old = migrateSettings({
      schemaVersion: 2,
      language: "en",
      background: "sakura",
      theme: "dark",
      sidebarWidth: 300,
    });
    expect(old).toMatchObject({
      language: "en",
      background: "sakura",
      theme: "dark",
      sidebarWidth: 300,
      customBackground: null,
    });
    const customBackground = {
      name: "sky.webp",
      dataUrl: "data:image/webp;base64," + btoa("RIFF0000WEBP"),
      fit: "cover" as const,
    };
    const custom = migrateSettings({
      ...old,
      background: "custom",
      customBackground,
    });
    expect(migrateSettings(settingsDocument(custom))).toEqual(custom);
    expect(settingsDocument(custom).schemaVersion).toBe(3);
    expect(normalizeSettingsPatch(custom, { customBackground: null })).toEqual({
      customBackground: null,
      background: "plain",
    });
    expect(
      migrateSettings({
        background: "custom",
        customBackground: {
          name: "remote",
          dataUrl: "https://example.com/a.png",
        },
      }),
    ).toMatchObject({ background: "plain", customBackground: null });
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
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, language: "en" });
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

describe("loadSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("没有存档时返回默认值", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("坏掉的 JSON 不会让应用崩溃", () => {
    window.localStorage.setItem(STORAGE_KEY, "{ not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("非法枚举值回落到默认值，合法值保留", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accent: "pink", language: "fr", menuBar: false }),
    );
    const settings = loadSettings();
    expect(settings.accent).toBe("neutral");
    expect(settings.language).toBe("zh");
    expect(settings.menuBar).toBe(false);
  });

  it("第一次使用按系统语言选择，无匹配时回落简中", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR", "en-GB"]);
    expect(loadSettings().language).toBe("en");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"]);
    expect(loadSettings().language).toBe("zh");
  });

  it.each(["zh", "en"])("旧存档语言 %s 优先于系统偏好", (language) => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([
      language === "zh" ? "en-US" : "zh-CN",
    ]);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ language }));
    expect(loadSettings().language).toBe(language);
  });

  it.each([
    ["gradient", "cloudscape"],
    ["grid", "starlight"],
    ["dots", "starlight"],
    ["contour", "starlight"],
    ["orbits", "starlight"],
    ["waves", "cloudscape"],
  ])("旧背景 %s 迁移到 %s", (background, expected) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ background }));
    expect(loadSettings().background).toBe(expected);
  });

  it("背景强度兼容旧存档并校验新取值", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ background: "moonlit", backgroundIntensity: "strong" }),
    );
    expect(loadSettings()).toMatchObject({
      background: "moonlit",
      backgroundIntensity: "strong",
    });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ backgroundIntensity: "invalid" }),
    );
    expect(loadSettings().backgroundIntensity).toBe("balanced");
  });
});

describe("applySettings", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("applies the saved theme before React mounts and resolves system preference", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const root = document.documentElement;
    root.classList.add("other-class");
    applySettings({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(root).toHaveClass("dark", "other-class");
    expect(root).not.toHaveClass("light");
    expect(root.style.colorScheme).toBe("dark");
    applySettings({ ...DEFAULT_SETTINGS, theme: "light" });
    expect(root).toHaveClass("light", "other-class");
    expect(root).not.toHaveClass("dark");
    expect(root.style.colorScheme).toBe("light");
    applySettings({ ...DEFAULT_SETTINGS, theme: "system" });
    expect(root).toHaveClass("dark");
    expect(root.style.colorScheme).toBe("dark");
    root.classList.remove("other-class");
  });
  it("把设置写到 html 的 data-* 与 lang", () => {
    applySettings({
      ...DEFAULT_SETTINGS,
      accent: "rose",
      font: "mono",
      language: "en",
      motion: "reduced",
      backgroundIntensity: "subtle",
    });

    const root = document.documentElement;
    expect(root.dataset.accent).toBe("rose");
    expect(root.dataset.font).toBe("mono");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.dataset.backgroundIntensity).toBe("subtle");
    expect(root.lang).toBe("en");
  });
});

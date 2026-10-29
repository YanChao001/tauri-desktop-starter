import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENTS,
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

vi.mock("@/config/app", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/app")>();
  return {
    ...original,
    APP_CONFIG: {
      ...original.APP_CONFIG,
      browserStorageNamespace: "tauri-starter",
    },
  };
});

describe("versioned settings model", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  });
  afterEach(() => vi.restoreAllMocks());
  it("扩展主题色可往返保存，旧偏好补齐自定义颜色而不改原预设", () => {
    for (const accent of ACCENTS) {
      const settings = { ...DEFAULT_SETTINGS, accent, customAccent: "#123ABC" };
      expect(migrateSettings(settingsDocument(settings))).toEqual(settings);
    }
    for (const document of [
      { accent: "blue" },
      { schemaVersion: 1, settings: { accent: "blue" } },
      { schemaVersion: 5, accent: "blue" },
    ])
      expect(migrateSettings(document)).toMatchObject({
        accent: "blue",
        customAccent: DEFAULT_SETTINGS.customAccent,
      });
    expect(settingsDocument(DEFAULT_SETTINGS).schemaVersion).toBe(6);
  });

  it("自定义颜色在存档与补丁边界规范化，切换预设保留已选颜色", () => {
    const custom = migrateSettings({
      accent: "custom",
      customAccent: " #aBc ",
    });
    expect(custom).toMatchObject({ accent: "custom", customAccent: "#AABBCC" });
    expect(
      normalizeSettingsPatch(DEFAULT_SETTINGS, {
        accent: "custom",
        customAccent: " #12abEF ",
      }),
    ).toEqual({ accent: "custom", customAccent: "#12ABEF" });
    expect(normalizeSettingsPatch(custom, { accent: "teal" })).toEqual({
      accent: "teal",
    });
    expect(migrateSettings({ ...custom, accent: "teal" }).customAccent).toBe(
      "#AABBCC",
    );
    expect(
      migrateSettings({
        accent: "custom",
        customAccent: "url(https://example.com)",
      }),
    ).toMatchObject({
      accent: "custom",
      customAccent: DEFAULT_SETTINGS.customAccent,
    });
  });
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

  it("旧存档默认跟随系统代理，连接方式在保存和补丁中保留", () => {
    expect(migrateSettings({ schemaVersion: 3 }).networkMode).toBe("system");
    expect(
      migrateSettings({
        schemaVersion: 1,
        settings: { networkMode: "direct" },
      }).networkMode,
    ).toBe("direct");
    for (const networkMode of ["system", "direct"] as const) {
      const settings = { ...DEFAULT_SETTINGS, networkMode };
      expect(migrateSettings(settingsDocument(settings)).networkMode).toBe(
        networkMode,
      );
      expect(normalizeSettingsPatch(DEFAULT_SETTINGS, { networkMode })).toEqual(
        {
          networkMode,
        },
      );
    }
  });

  it.each(["proxy", "auto", "", true, 1, null, { mode: "direct" }])(
    "非法连接方式 %j 回落到系统代理",
    (networkMode) => {
      expect(migrateSettings({ networkMode }).networkMode).toBe("system");
    },
  );

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

  it("schema 2 升级保留偏好，导入图片随当前 schema 存档并可移除", () => {
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
    expect(settingsDocument(custom).schemaVersion).toBe(SETTINGS_VERSION);
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
      accent: "invalid-accent",
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
      JSON.stringify({
        accent: "invalid-accent",
        language: "fr",
        menuBar: false,
      }),
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
      backgroundIntensity: 70,
    });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ backgroundIntensity: "invalid" }),
    );
    expect(loadSettings().backgroundIntensity).toBe(50);
  });
  it.each([
    ["subtle", 30],
    ["balanced", 50],
    ["strong", 70],
    [0, 0],
    [100, 100],
    [34, 30],
    [36, 40],
    [-10, 0],
    [110, 100],
    [NaN, 50],
    [Infinity, 50],
    ["90", 50],
  ] as const)(
    "强度 %s 迁移或规范化为 %s，保留其他偏好",
    (backgroundIntensity, expected) => {
      expect(
        migrateSettings({
          schemaVersion: 3,
          backgroundIntensity,
          accent: "rose",
        }),
      ).toMatchObject({ backgroundIntensity: expected, accent: "rose" });
    },
  );
});

describe("applySettings", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("自定义主题色只写专属变量，预设切换保留变量键且重置恢复默认配色", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.removeProperty("--primary");
    applySettings(
      { ...DEFAULT_SETTINGS, accent: "custom", customAccent: "#000000" },
      { includeTheme: false },
    );
    expect(root.dataset.accent).toBe("custom");
    expect(root.style.getPropertyValue("--custom-accent-light")).toBe(
      "#000000",
    );
    const dark = root.style.getPropertyValue("--custom-accent-dark");
    expect(dark).toMatch(/^#[0-9A-F]{6}$/);
    expect(dark).not.toBe("#000000");
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(root).toHaveClass("dark");
    applySettings(
      { ...DEFAULT_SETTINGS, accent: "cyan", customAccent: "#000000" },
      { includeTheme: false },
    );
    expect(root.dataset.accent).toBe("cyan");
    expect(root.style.getPropertyValue("--custom-accent-light")).toBe(
      "#000000",
    );
    expect(root.style.getPropertyValue("--custom-accent-dark")).toBe(dark);
    applySettings(DEFAULT_SETTINGS, { includeTheme: false });
    expect(root.dataset.accent).toBe("neutral");
    expect(root.style.getPropertyValue("--custom-accent-light")).not.toBe(
      "#000000",
    );
    expect(root.style.getPropertyValue("--custom-accent-dark")).toMatch(
      /^#[0-9A-F]{6}$/,
    );
    expect(root.style.getPropertyValue("--primary")).toBe("");
  });
  it("运行时应用其余偏好时保留主题旧帧，由主题同步统一提交", () => {
    const root = document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    applySettings(
      { ...DEFAULT_SETTINGS, theme: "light", accent: "rose" },
      { includeTheme: false },
    );
    expect(root).toHaveClass("dark");
    expect(root).not.toHaveClass("light");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.dataset.accent).toBe("rose");
  });
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
      backgroundIntensity: 30,
    });

    const root = document.documentElement;
    expect(root.dataset.accent).toBe("rose");
    expect(root.dataset.font).toBe("mono");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.dataset.backgroundIntensity).toBe("30");
    expect(root.style.getPropertyValue("--skin-exposure")).toBe("0.3");
    expect(root.lang).toBe("en");
  });
});

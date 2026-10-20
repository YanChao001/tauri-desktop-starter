import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySettings, DEFAULT_SETTINGS, loadSettings } from "./settings";

const STORAGE_KEY = "tauri-starter:settings";

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

  it("读不到存档时仍使用系统语言，不影响启动", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, language: "en" });
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

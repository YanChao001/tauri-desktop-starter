import { beforeEach, describe, expect, it } from "vitest";
import { applySettings, DEFAULT_SETTINGS, loadSettings } from "./settings";

const STORAGE_KEY = "tauri-starter:settings";

describe("loadSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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
});

describe("applySettings", () => {
  it("把设置写到 html 的 data-* 与 lang", () => {
    applySettings({
      ...DEFAULT_SETTINGS,
      accent: "rose",
      font: "mono",
      language: "en",
      motion: "reduced",
    });

    const root = document.documentElement;
    expect(root.dataset.accent).toBe("rose");
    expect(root.dataset.font).toBe("mono");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.lang).toBe("en");
  });
});

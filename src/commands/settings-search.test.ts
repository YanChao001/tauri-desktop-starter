import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";
import {
  focusSetting,
  searchSettings,
  SETTINGS_SEARCH_ENTRIES,
} from "./settings-search";

describe("settings search metadata", () => {
  afterEach(() => document.body.replaceChildren());
  it("matches translated labels and bilingual aliases with normalized text", () => {
    expect(
      searchSettings("中文", createTranslator(en)).map((entry) => entry.id),
    ).toContain("language");
    expect(
      searchSettings("ＤＡＲＫ", createTranslator(zhCN)).map(
        (entry) => entry.id,
      ),
    ).toContain("theme");
    expect(searchSettings("font size", createTranslator(en))[0]?.id).toBe(
      "fontSize",
    );
    expect(searchSettings("星星", createTranslator(zhCN))[0]?.id).toBe("skin");
    expect(searchSettings("云朵", createTranslator(zhCN))[0]?.id).toBe("skin");
    expect(searchSettings("sakura", createTranslator(en))[0]?.id).toBe("skin");
    expect(searchSettings("紧凑", createTranslator(zhCN))[0]?.id).toBe(
      "window",
    );
    expect(searchSettings("居中", createTranslator(zhCN))[0]?.id).toBe(
      "windowPosition",
    );
    expect(
      searchSettings("remember", createTranslator(en)).map((entry) => entry.id),
    ).toContain("windowPosition");
    expect(searchSettings("not-a-real-setting", createTranslator(en))).toEqual(
      [],
    );
    expect(searchSettings("  ", createTranslator(zhCN))).toEqual([]);
    expect(
      new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.anchor)).size,
    ).toBe(SETTINGS_SEARCH_ENTRIES.length);
  });
  it("finds all eight styles and local image controls in both interface languages", () => {
    for (const query of [
      "猫咪涂鸦",
      "咖啡时光",
      "远山手记",
      "星星手帐",
      "云朵晴空",
      "月相漫游",
      "枝叶小笺",
      "纸上飞行",
      "添加壁纸",
      "重命名壁纸",
    ])
      expect(searchSettings(query, createTranslator(zhCN))[0]?.id).toBe("skin");
    for (const query of [
      "cat doodles",
      "coffee break",
      "mountain notes",
      "linework",
      "cloud notes",
      "moon orbits",
      "leaf notes",
      "paper flights",
      "add wallpapers",
      "PNG",
    ])
      expect(searchSettings(query, createTranslator(en))[0]?.id).toBe("skin");
  });

  it("scrolls and transfers focus to the matching setting", () => {
    const target = document.createElement("section");
    target.id = "settings-language";
    target.tabIndex = -1;
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    expect(focusSetting(target.id)).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
    expect(target).toHaveFocus();
    expect(focusSetting("missing")).toBe(false);
  });
});

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
    expect(searchSettings("樱花", createTranslator(zhCN))[0]?.id).toBe("skin");
    expect(searchSettings("sakura", createTranslator(en))[0]?.id).toBe("skin");
    expect(searchSettings("not-a-real-setting", createTranslator(en))).toEqual(
      [],
    );
    expect(searchSettings("  ", createTranslator(zhCN))).toEqual([]);
    expect(
      new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.anchor)).size,
    ).toBe(SETTINGS_SEARCH_ENTRIES.length);
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

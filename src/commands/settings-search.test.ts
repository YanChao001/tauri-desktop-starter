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
  it("按新预设名称、HEX和自定义颜色入口定位主题色", () => {
    for (const [dictionary, queries] of [
      [
        zhCN,
        [
          "青蓝",
          "松石",
          "青柠",
          "日落橙",
          "樱粉",
          "雾灰",
          "自定义主题色",
          "HEX 色值",
          "十六进制",
          "取色",
        ],
      ],
      [
        en,
        [
          "Cyan",
          "Teal",
          "Lime",
          "Orange",
          "Pink",
          "Slate",
          "Custom accent",
          "HEX",
          "hexadecimal",
          "Pick a color",
        ],
      ],
    ] as const) {
      for (const query of queries)
        expect(
          searchSettings(query, createTranslator(dictionary)),
        ).toContainEqual(
          expect.objectContaining({ id: "accent", anchor: "settings-accent" }),
        );
    }
  });
  it("finds startup, background operation and multiple windows in shared settings", () => {
    for (const [query, id] of [
      ["登录", "autostart"],
      ["后台", "background"],
      ["多窗口", "windows"],
    ] as const)
      expect(
        searchSettings(query, createTranslator(zhCN)).map((entry) => entry.id),
      ).toContain(id);
    for (const [query, id] of [
      ["autostart", "autostart"],
      ["keep running", "background"],
      ["second window", "windows"],
    ] as const)
      expect(
        searchSettings(query, createTranslator(en)).map((entry) => entry.id),
      ).toContain(id);
  });

  it("finds the host network mode through translated choices and bilingual aliases", () => {
    for (const query of ["代理", "直连", "直链", "网络", "系统代理"])
      expect(searchSettings(query, createTranslator(zhCN))).toContainEqual(
        expect.objectContaining({
          id: "networkMode",
          anchor: "settings-networkMode",
        }),
      );
    for (const query of ["proxy", "direct", "network", "system proxy"])
      expect(searchSettings(query, createTranslator(en))).toContainEqual(
        expect.objectContaining({
          id: "networkMode",
          anchor: "settings-networkMode",
        }),
      );
    for (const dictionary of [zhCN, en]) {
      const t = createTranslator(dictionary);
      for (const key of [
        "settings.networkModeSystem",
        "settings.networkModeDirect",
      ] as const)
        expect(searchSettings(t(key), t).map((entry) => entry.id)).toContain(
          "networkMode",
        );
    }
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
  it("finds update checks, the startup preference and current version in both languages", () => {
    for (const [query, id, anchor] of [
      ["检查更新", "updates", "settings-updates-check"],
      ["自动更新", "autoUpdates", "settings-updates-auto"],
      ["版本", "version", "settings-updates-version"],
    ] as const) {
      expect(searchSettings(query, createTranslator(zhCN))).toContainEqual(
        expect.objectContaining({ id, anchor }),
      );
    }
    for (const [query, id] of [
      ["check for updates", "updates"],
      ["automatic updates", "autoUpdates"],
      ["version", "version"],
    ] as const)
      expect(
        searchSettings(query, createTranslator(en)).map((entry) => entry.id),
      ).toContain(id);
  });
});

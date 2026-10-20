import type { Translate } from "@/i18n/translate";
import type { DictKey } from "@/providers/i18n";
import {
  BACKGROUND_METADATA,
  BACKGROUND_INTENSITY_METADATA,
} from "@/lib/backgrounds";

export type SettingsSearchEntry = {
  id: string;
  anchor: string;
  labelKey: DictKey;
  descriptionKey?: DictKey;
  searchKeys?: readonly DictKey[];
  keywords: readonly string[];
};

/** 设置搜索与应用命令面板共用的搜索入口 */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "language",
    anchor: "settings-language",
    labelKey: "common.language",
    descriptionKey: "settings.languageDescription",
    keywords: ["language", "locale", "语言", "中文", "english"],
  },
  {
    id: "theme",
    anchor: "settings-theme",
    labelKey: "settings.theme",
    keywords: ["theme", "light", "dark", "主题", "深色", "浅色"],
  },
  {
    id: "accent",
    anchor: "settings-accent",
    labelKey: "settings.accent",
    descriptionKey: "settings.accentHint",
    keywords: ["accent", "color", "颜色", "主题色"],
  },
  {
    id: "radius",
    anchor: "settings-radius",
    labelKey: "settings.radius",
    keywords: ["radius", "corners", "圆角"],
  },
  {
    id: "font",
    anchor: "settings-font",
    labelKey: "settings.font",
    keywords: ["font", "typeface", "字体"],
  },
  {
    id: "fontSize",
    anchor: "settings-fontSize",
    labelKey: "settings.fontSize",
    keywords: ["font size", "text size", "字号"],
  },
  {
    id: "skin",
    anchor: "settings-skin",
    labelKey: "settings.skinGallery",
    descriptionKey: "settings.skinGalleryDescription",
    searchKeys: Object.values(BACKGROUND_METADATA).flatMap((item) => [
      item.labelKey,
      item.descriptionKey,
    ]),
    keywords: [
      "background",
      "skin",
      "wallpaper",
      "stars",
      ...Object.keys(BACKGROUND_METADATA),
      "背景",
      "皮肤",
      "插画",
      "星星",
    ],
  },
  {
    id: "backgroundIntensity",
    anchor: "settings-backgroundIntensity",
    labelKey: "settings.backgroundIntensity",
    descriptionKey: "settings.backgroundIntensityDescription",
    searchKeys: Object.values(BACKGROUND_INTENSITY_METADATA).map(
      (item) => item.labelKey,
    ),
    keywords: ["intensity", "opacity", "强度", "透明"],
  },
  {
    id: "motion",
    anchor: "settings-motion",
    labelKey: "settings.motion",
    descriptionKey: "settings.motionHint",
    keywords: ["motion", "animation", "reduce", "动画", "动效"],
  },
  {
    id: "menuBar",
    anchor: "settings-menuBar",
    labelKey: "settings.menuBar",
    descriptionKey: "settings.menuBarHint",
    keywords: ["menu", "titlebar", "菜单", "标题栏"],
  },
  {
    id: "layout",
    anchor: "settings-layout",
    labelKey: "settings.layout",
    keywords: ["sidebar", "layout", "width", "侧栏", "布局", "宽度"],
  },
  {
    id: "appMode",
    anchor: "settings-appMode",
    labelKey: "settings.appMode",
    descriptionKey: "settings.appModeDescription",
    keywords: ["demo", "minimal", "mode", "演示", "精简", "模式"],
  },
  {
    id: "window",
    anchor: "settings-window",
    labelKey: "settings.windowSize",
    descriptionKey: "settings.windowSizeHint",
    searchKeys: [
      "settings.windowCompact",
      "settings.windowStandard",
      "settings.windowComfortable",
      "settings.windowSpacious",
    ],
    keywords: [
      "window",
      "resize",
      "dimensions",
      "preset",
      "窗口",
      "大小",
      "尺寸",
      "预设",
      "宽度",
      "高度",
    ],
  },
  {
    id: "windowPosition",
    anchor: "settings-windowPosition",
    labelKey: "settings.windowPosition",
    descriptionKey: "settings.windowPositionHint",
    searchKeys: [
      "settings.windowPositionRemember",
      "settings.windowPositionCenter",
    ],
    keywords: [
      "startup position",
      "center",
      "remember",
      "启动位置",
      "居中",
      "上次位置",
    ],
  },
];

export function searchSettings(
  query: string,
  t: Translate,
): SettingsSearchEntry[] {
  const normalized = query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);
  return SETTINGS_SEARCH_ENTRIES.map((entry, index) => {
    const label = t(entry.labelKey).toLocaleLowerCase();
    const haystack = [
      label,
      entry.descriptionKey && t(entry.descriptionKey),
      ...(entry.searchKeys?.map((key) => t(key)) ?? []),
      ...entry.keywords,
    ]
      .filter(Boolean)
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase();
    return {
      entry,
      index,
      label,
      matches: terms.every((term) => haystack.includes(term)),
    };
  })
    .filter((item) => item.matches)
    .sort(
      (a, b) =>
        Number(b.label === normalized) - Number(a.label === normalized) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

export function focusSetting(anchor: string): boolean {
  const target = document.getElementById(anchor);
  if (!target) return false;
  target.scrollIntoView({ block: "center", behavior: "auto" });
  target.focus({ preventScroll: true });
  return true;
}

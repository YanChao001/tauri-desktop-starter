import { en } from "./en";
import { zhCN, type Messages } from "./zh-CN";

type LocaleDefinition = {
  nativeName: string;
  shortLabel: string;
  documentLang: string;
  matches: readonly string[];
  messages: Messages;
};

/** 新语言只在这里注册，选择器、存档校验与文档语言随之更新。 */
export const LOCALES = {
  zh: {
    nativeName: "简体中文",
    shortLabel: "中",
    documentLang: "zh-CN",
    matches: ["zh"],
    messages: zhCN,
  },
  en: {
    nativeName: "English",
    shortLabel: "EN",
    documentLang: "en",
    matches: ["en"],
    messages: en,
  },
} as const satisfies Record<string, LocaleDefinition>;

export type Language = keyof typeof LOCALES;
export const LANGUAGES = Object.keys(LOCALES) as readonly Language[];
export const DEFAULT_LANGUAGE: Language = "zh";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

export function getLocale(language: unknown) {
  return LOCALES[isLanguage(language) ? language : DEFAULT_LANGUAGE];
}

/** 按系统偏好顺序匹配；更具体的地区 / 文字标签优先于通用语言。 */
export function detectLanguage(
  preferences: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): Language {
  for (const preference of preferences) {
    const tag = preference.toLowerCase().replaceAll("_", "-");
    let match: Language | undefined;
    let specificity = 0;
    for (const language of LANGUAGES) {
      for (const pattern of LOCALES[language].matches) {
        const prefix = pattern.toLowerCase();
        if (
          (tag === prefix || tag.startsWith(`${prefix}-`)) &&
          prefix.length > specificity
        ) {
          match = language;
          specificity = prefix.length;
        }
      }
    }
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

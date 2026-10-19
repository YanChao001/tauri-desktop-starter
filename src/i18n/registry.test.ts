import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  getLocale,
  isLanguage,
  LANGUAGES,
  LOCALES,
} from "./registry";
import { createTranslator } from "./translate";
import { zhCN, type MessageKey } from "./zh-CN";

describe("语言资源", () => {
  it("每个已注册语言覆盖全部词条并保留相同插值参数", () => {
    const keys = Object.keys(zhCN) as MessageKey[];
    const placeholders = (text: string) =>
      [...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    for (const language of LANGUAGES) {
      const locale = LOCALES[language];
      expect(Object.keys(locale.messages).sort()).toEqual([...keys].sort());
      expect(Intl.getCanonicalLocales(locale.documentLang)).toHaveLength(1);
      for (const key of keys) {
        expect(locale.messages[key].trim(), `${language}: ${key}`).not.toBe("");
        expect(
          placeholders(locale.messages[key]),
          `${language}: ${key}`,
        ).toEqual(placeholders(zhCN[key]));
      }
    }
  });

  it.each([undefined, null, "fr", "zh-TW", "toString", "__proto__"])(
    "非法或尚未支持的存档值 %s 不会成为语言代码",
    (value) => {
      expect(isLanguage(value)).toBe(false);
      expect(getLocale(value)).toBe(LOCALES.zh);
    },
  );

  it.each([
    { preferences: ["fr-FR", "en-GB", "zh-CN"], expected: "en" },
    { preferences: ["zh-TW", "en-US"], expected: "zh" },
    { preferences: ["ZH_hant_HK"], expected: "zh" },
    { preferences: ["EN_us"], expected: "en" },
    { preferences: ["english", "fr-FR"], expected: "zh" },
    { preferences: [], expected: "zh" },
  ])("按系统偏好匹配 $preferences → $expected", ({ preferences, expected }) => {
    expect(detectLanguage(preferences)).toBe(expected);
  });
});

describe("词条回退与插值", () => {
  it("缺词和空词条回退默认语言，未知占位符保留", () => {
    const t = createTranslator({ "common.copy": "" });
    expect(t("common.copy")).toBe("复制");
    expect(t("motion.item")).toBe("动效条目 {index}");
    expect(t("motion.item", { index: 0 })).toBe("动效条目 0");
  });

  it("占位符只替换一次，错误文本中的模板或美元符号保持原样", () => {
    const t = createTranslator(LOCALES.en.messages);
    expect(t("bridge.failed", { error: "{index} $&", index: 5 })).toBe(
      "Call failed: {index} $&",
    );
  });
});

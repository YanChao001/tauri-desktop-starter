import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getLocale } from "@/i18n/registry";
import { createTranslator, type Translate } from "@/i18n/translate";
import { useSettings, type Language } from "@/providers/settings";

export type { MessageKey as DictKey } from "@/i18n/zh-CN";

type I18nContextValue = {
  language: Language;
  t: Translate;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const language = settings.language;
  const value = useMemo<I18nContextValue>(
    () => ({ language, t: createTranslator(getLocale(language).messages) }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n 必须在 I18nProvider 内使用");
  return context;
}

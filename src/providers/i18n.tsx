import { useContext, useMemo, type ReactNode } from "react";
import { getLocale } from "@/i18n/registry";
import { createTranslator } from "@/i18n/translate";
import { useSettings } from "@/providers/settings";
import { I18nContext, type I18nContextValue } from "./i18n-context";

export type { MessageKey as DictKey } from "@/i18n/zh-CN";

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

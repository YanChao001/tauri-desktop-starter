import { createContext } from "react";
import type { Translate } from "@/i18n/translate";
import type { Language } from "@/lib/settings-model";

export type I18nContextValue = {
  language: Language;
  t: Translate;
};

// 上下文与热更新的组件分开，避免旧消费者读到另一份 Context。
export const I18nContext = createContext<I18nContextValue | null>(null);

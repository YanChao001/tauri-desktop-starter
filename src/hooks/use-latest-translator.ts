import { useCallback, useLayoutEffect, useRef } from "react";
import type { Translate } from "@/i18n/translate";
import { useI18n } from "@/providers/i18n";

/** 异步通知使用最新已提交的语言；普通 t 仍保留随语言变化的语义。 */
export function useLatestTranslator(): Translate {
  const { t } = useI18n();
  const current = useRef(t);
  useLayoutEffect(() => {
    current.current = t;
  }, [t]);
  return useCallback<Translate>((key, vars) => current.current(key, vars), []);
}

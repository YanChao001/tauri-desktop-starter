import { STORAGE_KEY } from "@/lib/settings-model";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "@/providers/i18n";
import { SettingsProvider, useSettings } from "@/providers/settings";
import { useLatestTranslator } from "./use-latest-translator";

function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <I18nProvider>{children}</I18nProvider>
    </SettingsProvider>
  );
}

describe("useLatestTranslator", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ language: "zh" }),
    );
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("旧异步回调可取到新语言，同时普通 t 仍按语言更新引用", () => {
    const { result } = renderHook(
      () => ({
        t: useI18n().t,
        latest: useLatestTranslator(),
        update: useSettings().update,
      }),
      { wrapper: Providers },
    );
    const original = result.current;
    act(() => original.update({ language: "en" }));

    expect(result.current.t).not.toBe(original.t);
    expect(original.t("common.copied")).toBe("已复制到剪贴板");
    expect(result.current.latest).toBe(original.latest);
    expect(original.latest("common.copied")).toBe("Copied to clipboard");
    expect(original.latest("settings.searchResults", { count: 2 })).toBe(
      "Found 2 settings",
    );
  });
});

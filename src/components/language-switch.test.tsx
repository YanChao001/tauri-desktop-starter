import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitch } from "./language-switch";
import { I18nProvider, useI18n } from "@/providers/i18n";
import { SettingsProvider } from "@/providers/settings";
import { TooltipProvider } from "@/components/ui/tooltip";

const scrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

function TranslatedContent() {
  const { t } = useI18n();
  return <h1>{t("settings.title")}</h1>;
}

function renderSwitches() {
  return render(
    <SettingsProvider>
      <I18nProvider>
        <TooltipProvider>
          <LanguageSwitch />
          <LanguageSwitch compact />
          <TranslatedContent />
        </TooltipProvider>
      </I18nProvider>
    </SettingsProvider>,
  );
}

describe("LanguageSwitch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (scrollIntoView)
      Object.defineProperty(
        Element.prototype,
        "scrollIntoView",
        scrollIntoView,
      );
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("标题栏和设置页即时同步翻译、文档语言与存档，重开仍保留选择", () => {
    const { unmount } = renderSwitches();
    const selectors = screen.getAllByRole("combobox", { name: "语言" });
    expect(selectors[0]).toHaveTextContent("简体中文");
    expect(selectors[1]).toHaveTextContent("中");
    fireEvent.keyDown(selectors[1]!, { key: "Enter" });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: "English" }));

    const englishSelectors = screen.getAllByRole("combobox", {
      name: "Language",
    });
    expect(englishSelectors[0]).toHaveTextContent("English");
    expect(englishSelectors[1]).toHaveTextContent("EN");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
    expect(
      JSON.parse(window.localStorage.getItem("tauri-starter:settings")!),
    ).toMatchObject({ language: "en" });

    unmount();
    renderSwitches();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("语言列表可只通过键盘选择，选项标记自己的语言", () => {
    renderSwitches();
    fireEvent.keyDown(screen.getAllByRole("combobox", { name: "语言" })[0]!, {
      key: "ArrowDown",
    });
    const option = screen.getByRole("option", { name: "English" });
    expect(option).toHaveAttribute("lang", "en");
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

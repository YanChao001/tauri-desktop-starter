import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/providers/i18n";
import { DEFAULT_SETTINGS, SettingsProvider } from "@/providers/settings";
import Settings from "./settings";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
  getAppInfo: vi.fn(),
  openExternal: vi.fn(),
}));

describe("设置页", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("提供语言切换入口并将新语言写入文档和存档", () => {
    render(
      <SettingsProvider>
        <I18nProvider>
          <Settings />
        </I18nProvider>
      </SettingsProvider>,
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "语言" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("English");
    expect(document.documentElement.lang).toBe("en");
    expect(
      JSON.parse(window.localStorage.getItem("tauri-starter:settings")!),
    ).toMatchObject({ language: "en" });
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("重置外观时保留用户语言并恢复其余默认偏好", () => {
    window.localStorage.setItem(
      "tauri-starter:settings",
      JSON.stringify({
        language: "en",
        accent: "rose",
        font: "mono",
        motion: "reduced",
        menuBar: false,
      }),
    );
    render(
      <SettingsProvider>
        <I18nProvider>
          <Settings />
        </I18nProvider>
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset appearance" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(
      JSON.parse(window.localStorage.getItem("tauri-starter:settings")!),
    ).toEqual({ ...DEFAULT_SETTINGS, language: "en" });
  });
});

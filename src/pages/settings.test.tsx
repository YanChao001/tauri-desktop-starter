import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/providers/i18n";
import { DEFAULT_SETTINGS, SettingsProvider } from "@/providers/settings";
import Settings from "./settings";
import { SETTINGS_VERSION } from "@/lib/settings-model";

function SettingsView() {
  return (
    <MemoryRouter>
      <SettingsProvider>
        <I18nProvider>
          <Settings />
        </I18nProvider>
      </SettingsProvider>
    </MemoryRouter>
  );
}

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
    window.localStorage.setItem(
      "tauri-starter:settings",
      JSON.stringify({ language: "zh" }),
    );
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("提供语言切换入口并将新语言写入文档和存档", () => {
    render(<SettingsView />);
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
        background: "sakura",
        backgroundIntensity: "strong",
      }),
    );
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Reset preferences" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(
      JSON.parse(window.localStorage.getItem("tauri-starter:settings")!),
    ).toEqual({
      schemaVersion: SETTINGS_VERSION,
      ...DEFAULT_SETTINGS,
      language: "en",
    });
  });

  it("皮肤与强度即时生效、持久化，并在纯色皮肤下禁用强度", () => {
    const view = () => <SettingsView />;
    const { unmount } = render(view());
    expect(screen.getByRole("radio", { name: "轻盈" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "樱花来信" }));
    fireEvent.click(screen.getByRole("radio", { name: "鲜明" }));
    expect(document.documentElement).toHaveAttribute(
      "data-background",
      "sakura",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-background-intensity",
      "strong",
    );
    unmount();
    render(view());
    expect(screen.getByRole("radio", { name: "樱花来信" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "鲜明" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "纯色" }));
    expect(screen.getByRole("radio", { name: "鲜明" })).toBeDisabled();
    expect(document.documentElement).toHaveAttribute(
      "data-background",
      "plain",
    );
  });
});

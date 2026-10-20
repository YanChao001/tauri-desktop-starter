import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider, STORAGE_KEY } from "@/providers/settings";
import { I18nProvider } from "@/providers/i18n";
import Overview from "./overview";
const actions = vi.hoisted(() => ({ palette: vi.fn(), theme: vi.fn() }));
vi.mock("@/providers/commands", () => ({
  useCommands: () => ({ setPaletteOpen: actions.palette }),
}));
vi.mock("@/hooks/use-theme-switch", () => ({
  useThemeSwitch: () => ({ setTheme: actions.theme }),
}));
vi.mock("@/lib/tauri", () => ({ isTauri: () => false }));
function view() {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <I18nProvider>
          <Overview />
        </I18nProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}
describe("interactive showroom", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        language: "zh",
        accent: "blue",
        background: "cloudscape",
        radius: "sharp",
        theme: "system",
      }),
    );
    vi.clearAllMocks();
  });
  afterEach(cleanup);
  it("previews without changing settings, then applies and can undo the appearance", () => {
    view();
    const before = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    fireEvent.click(screen.getByRole("radio", { name: "樱花来信" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "应用到窗口" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      accent: "rose",
      background: "sakura",
      radius: "soft",
    });
    expect(actions.theme).toHaveBeenLastCalledWith("light");
    fireEvent.click(screen.getByRole("button", { name: "撤销换装" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      accent: "blue",
      background: "cloudscape",
      radius: "sharp",
      theme: "system",
    });
    expect(actions.theme).toHaveBeenLastCalledWith("system");
    expect(
      screen.queryByText(/1\.41 MB|144 KB|工程状态|构建健康度/),
    ).not.toBeInTheDocument();
  });
  it("offers working destinations and a real command-palette entry", () => {
    view();
    expect(
      screen.getByRole("link", { name: /进入动效实验室/ }),
    ).toHaveAttribute("href", "/motion");
    expect(screen.getByRole("link", { name: /探索交互场景/ })).toHaveAttribute(
      "href",
      "/components",
    );
    fireEvent.click(screen.getByRole("button", { name: /打开快速操作/ }));
    expect(actions.palette).toHaveBeenCalledWith(true);
  });
  it("keeps a purposeful workspace in minimal mode without demo promotion", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ language: "zh", appMode: "minimal" }),
    );
    view();
    expect(screen.queryByTestId("showroom")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/desktop", "/database", "/settings"]);
  });
});

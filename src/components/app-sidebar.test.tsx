import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeIcon } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/providers/i18n";
import { CommandsProvider } from "@/providers/commands";
import { SettingsProvider, STORAGE_KEY } from "@/providers/settings";
import type { AppRoute } from "@/routes";
import { AppSidebar } from "./app-sidebar";

vi.mock("@/routes", () => ({ APP_ROUTES: [] }));

vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
  minimizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  quitApp: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("@/hooks/use-theme-switch", () => ({
  useThemeSwitch: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
    toggle: vi.fn(),
  }),
}));
const routes: AppRoute[] = [
  {
    path: "/",
    labelKey: "nav.overview",
    icon: HomeIcon,
    component: () => null,
    exact: true,
  },
];
function renderSidebar() {
  return render(
    <MemoryRouter>
      <SettingsProvider>
        <I18nProvider>
          <CommandsProvider>
            <TooltipProvider>
              <AppSidebar routes={routes} />
            </TooltipProvider>
          </CommandsProvider>
        </I18nProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}
describe("persisted application sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: "zh" }));
  });
  afterEach(cleanup);
  it("preserves navigation layout classes through the Radix tooltip slot", () => {
    renderSidebar();
    const link = screen.getByRole("link", { name: "概览" });
    expect(link).toHaveClass("flex", "items-center");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).not.toContain("=>");
  });
  it("adjusts width by keyboard within bounds and persists it", () => {
    renderSidebar();
    const separator = screen.getByRole("separator", { name: "调整侧栏宽度" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "232");
    fireEvent.keyDown(separator, { key: "End" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "360");
    fireEvent.keyDown(separator, { key: "Home" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "180");
    fireEvent.keyDown(separator, { key: "Enter" });
    expect(separator).toHaveAttribute("aria-valuenow", "224");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sidebarWidth).toBe(
      224,
    );
  });
  it("keeps collapsed navigation named and restores the saved width", () => {
    const view = renderSidebar();
    fireEvent.keyDown(screen.getByRole("separator"), {
      key: "ArrowRight",
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(screen.getByRole("link", { name: "概览" })).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开侧栏" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    view.unmount();
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "256",
    );
  });
});

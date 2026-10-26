import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/providers/i18n";
import { SettingsProvider, STORAGE_KEY } from "@/providers/settings";
import { SettingsSearch } from "./settings-search";

vi.mock("@/lib/tauri", () => ({ isTauri: () => false }));
function Content() {
  const navigate = useNavigate();
  return (
    <>
      <SettingsSearch />
      <section id="settings-theme" tabIndex={-1}>
        Theme target
      </section>
      <button onClick={() => navigate("/settings?focus=theme")}>
        Locate again
      </button>
    </>
  );
}
function search(initial = "/settings") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <SettingsProvider>
        <I18nProvider>
          <Content />
        </I18nProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}
describe("settings search", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: "zh" }));
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  it("moves focus to a result while respecting IME input", () => {
    search();
    const input = screen.getByRole("searchbox", { name: "搜索设置" });
    fireEvent.change(input, { target: { value: "dark" } });
    input.focus();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Theme target")).toHaveFocus();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "unknown-no-match" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的设置");
  });
  it("renders results in an anchored popup and keeps typing focus until selection or Escape", () => {
    const { container } = search();
    const input = screen.getByRole("searchbox", { name: "搜索设置" });
    input.focus();
    fireEvent.change(input, { target: { value: "dark" } });
    const popup = screen.getByRole("dialog", { name: "搜索设置" });
    expect(container).not.toContainElement(popup);
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription(/找到 \d+ 项设置/);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /主题/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /主题/ }));
    expect(screen.getByText("Theme target")).toHaveFocus();
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "dark" } });
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("focuses deep links on entry and repeated navigation to the same setting", () => {
    search("/settings?focus=theme");
    const target = screen.getByText("Theme target");
    expect(target).toHaveFocus();
    screen.getByRole("searchbox").focus();
    fireEvent.click(screen.getByText("Locate again"));
    expect(target).toHaveFocus();
  });
});

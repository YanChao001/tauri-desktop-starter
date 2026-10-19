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
    fireEvent.change(input, { target: { value: "unknown-no-match" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的设置");
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

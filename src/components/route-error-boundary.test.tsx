import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/providers/i18n";
import {
  SettingsProvider,
  STORAGE_KEY,
  useSettings,
} from "@/providers/settings";
import { reportClientError } from "@/lib/report-error";
import { RouteErrorBoundary } from "./route-error-boundary";

vi.mock("@/lib/tauri", () => ({ isTauri: () => false }));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
function Broken() {
  throw new Error("Page failure");
  return null;
}
function Shell() {
  const { update } = useSettings();
  return (
    <>
      <nav aria-label="Preserved navigation">
        <Link to="/">Home</Link>
      </nav>
      <button onClick={() => update({ language: "en" })}>English</button>
      <RouteErrorBoundary>
        <Outlet />
      </RouteErrorBoundary>
    </>
  );
}
describe("route error boundary", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: "zh" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("preserves page state across repeated navigation and query changes", () => {
    function DraftPage() {
      const [draft, setDraft] = useState("");
      return (
        <input
          aria-label="Working draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    }
    render(
      <MemoryRouter initialEntries={["/draft"]}>
        <SettingsProvider>
          <I18nProvider>
            <Link to="/draft">Current page</Link>
            <Link to="/draft?section=details">Details section</Link>
            <RouteErrorBoundary>
              <DraftPage />
            </RouteErrorBoundary>
          </I18nProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    const draft = screen.getByRole("textbox", { name: "Working draft" });
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    for (const name of ["Current page", "Details section"]) {
      fireEvent.click(screen.getByRole("link", { name }));
      expect(screen.getByRole("textbox", { name: "Working draft" })).toBe(
        draft,
      );
      expect(draft).toHaveValue("Keep this draft");
    }
  });
  it("recovers a failed page when navigating to the same path again", () => {
    let broken = true;
    function TransientPage() {
      if (broken) throw new Error("Transient failure");
      return <p>Recovered page</p>;
    }
    render(
      <MemoryRouter initialEntries={["/broken"]}>
        <SettingsProvider>
          <I18nProvider>
            <Link to="/broken">Current page</Link>
            <RouteErrorBoundary>
              <TransientPage />
            </RouteErrorBoundary>
          </I18nProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toBeVisible();
    broken = false;
    fireEvent.click(screen.getByRole("link", { name: "Current page" }));
    expect(screen.getByText("Recovered page")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps a new navigation failure visible without retrying it automatically", () => {
    render(
      <MemoryRouter>
        <SettingsProvider>
          <I18nProvider>
            <Link to="/broken">Broken page</Link>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<p>Working home</p>} />
                <Route path="broken" element={<Broken />} />
              </Route>
            </Routes>
          </I18nProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Broken page" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Page failure");
    expect(reportClientError).toHaveBeenCalledOnce();
  });
  it("retries a transient page failure in place while preserving the shell", () => {
    let broken = true;
    function TransientPage() {
      if (broken) throw new Error("Transient failure");
      return <p>Recovered page</p>;
    }
    render(
      <MemoryRouter initialEntries={["/broken"]}>
        <SettingsProvider>
          <I18nProvider>
            <Shell />
            <RouteErrorBoundary>
              <TransientPage />
            </RouteErrorBoundary>
          </I18nProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    const navigation = screen.getByRole("navigation");
    expect(screen.getByRole("alert")).toBeVisible();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("Recovered page")).toBeVisible();
    expect(screen.getByRole("navigation")).toBe(navigation);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("preserves shell navigation, translates the fallback live and recovers after navigation", () => {
    render(
      <MemoryRouter initialEntries={["/broken"]}>
        <SettingsProvider>
          <I18nProvider>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<p>Working home</p>} />
                <Route path="broken" element={<Broken />} />
              </Route>
            </Routes>
          </I18nProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("navigation", { name: "Preserved navigation" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("界面出错了");
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Page failure" }),
      expect.any(String),
    );
    fireEvent.click(screen.getByText("English"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The interface encountered an error",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    expect(screen.getByText("Working home")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

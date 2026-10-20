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

import { useEffect, useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRoute } from "@/routes";
import { AppShell } from "./app-shell";

const state = vi.hoisted(() => ({ appMode: "demo" }));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { appMode: state.appMode } }),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/title-bar", () => ({ TitleBar: () => null }));
vi.mock("@/components/window-background", () => ({
  WindowBackground: () => null,
}));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: ({ routes }: { routes: readonly AppRoute[] }) => (
    <nav aria-label="Test sidebar">
      {routes.map(({ path }) => (
        <Link key={path} to={path}>
          {path}
        </Link>
      ))}
    </nav>
  ),
}));

function Page() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (search === "?focus=language") {
      input.current?.focus({ preventScroll: true });
    }
  }, [search]);
  return (
    <section>
      <h1>Page content</h1>
      <input ref={input} aria-label="Page input" />
      <button
        onClick={() => {
          navigate("/settings?focus=language");
        }}
      >
        Focus setting
      </button>
    </section>
  );
}

function renderShell(initial = "/") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Page />} />
          <Route path="settings" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("application content navigation", () => {
  beforeEach(() => {
    state.appMode = "demo";
  });
  afterEach(cleanup);

  it("resets the scroll container on page navigation while keeping navigation focus", () => {
    renderShell();
    const main = screen.getByRole("main");
    main.scrollTop = 300;
    main.scrollLeft = 20;
    const settings = screen.getByRole("link", { name: "/settings" });
    settings.focus();
    fireEvent.click(settings);
    expect(main.scrollTop).toBe(0);
    expect(main.scrollLeft).toBe(0);
    expect(settings).toHaveFocus();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("navigation", { name: "navContext.location" }),
    ).toHaveTextContent("navGroup.systemnav.settings");
  });

  it("leaves query-based settings focus and scrolling to the page", () => {
    renderShell("/settings");
    const main = screen.getByRole("main");
    main.scrollTop = 240;
    fireEvent.click(screen.getByRole("button", { name: "Focus setting" }));
    expect(main.scrollTop).toBe(240);
    expect(screen.getByRole("textbox", { name: "Page input" })).toHaveFocus();
  });

  it("keeps minimal mode route visibility unchanged", () => {
    state.appMode = "minimal";
    renderShell();
    expect(
      screen.queryByRole("link", { name: "/components" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "/motion" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "/bridge" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/desktop" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/settings" })).toBeInTheDocument();
  });
});

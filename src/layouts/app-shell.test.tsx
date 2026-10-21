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
  useSettings: () => ({
    settings: {
      appMode: state.appMode,
      sidebarWidth: 224,
      sidebarCollapsed: false,
    },
  }),
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

describe("应用内容导航", () => {
  let resizeHeader: () => void;
  const disconnect = vi.fn();
  beforeEach(() => {
    state.appMode = "demo";
    disconnect.mockClear();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeHeader = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("切换页面时只重置内容区滚动并保留导航焦点", () => {
    renderShell();
    const main = screen.getByRole("main");
    main.scrollTop = 500;
    main.scrollLeft = 40;
    vi.mocked(window.scrollTo).mockClear();
    const settings = screen.getByRole("link", { name: "/settings" });
    settings.focus();
    fireEvent.click(settings);
    expect(main.scrollTop).toBe(0);
    expect(main.scrollLeft).toBe(0);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(settings).toHaveFocus();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("navigation", { name: "navContext.location" }),
    ).toHaveTextContent("navGroup.systemnav.settings");
  });

  it("同页查询参数变化时保留设置定位和滚动", () => {
    renderShell("/settings");
    const main = screen.getByRole("main");
    main.scrollTop = 240;
    vi.mocked(window.scrollTo).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Focus setting" }));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(main.scrollTop).toBe(240);
    expect(screen.getByRole("textbox", { name: "Page input" })).toHaveFocus();
  });

  it("精简模式按路由配置隐藏演示入口", () => {
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

  it("顶部说明栏换行后更新布局空间，卸载时清理观察器", () => {
    const view = renderShell();
    const header = view.container.querySelector(".app-chrome")!;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      height: 132,
    } as DOMRect);
    resizeHeader();
    expect(
      document.documentElement.style.getPropertyValue("--app-chrome-height"),
    ).toBe("132px");
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(
      document.documentElement.style.getPropertyValue("--app-chrome-height"),
    ).toBe("");
  });
});

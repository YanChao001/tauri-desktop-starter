import { lazy, useEffect, useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
vi.mock("@/features/extensions/extensions-provider", () => ({
  useExtensions: () => ({ data: null }),
}));
vi.mock("@/providers/commands", () => ({
  useCommands: () => ({ fullscreen: false, execute: vi.fn() }),
}));
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
  AppSidebar: ({
    routes,
    onWidthPreview,
  }: {
    routes: readonly AppRoute[];
    onWidthPreview: (width: number | null) => void;
  }) => (
    <nav aria-label="Test sidebar">
      <button onClick={() => onWidthPreview(280)}>Preview sidebar width</button>
      <button onClick={() => onWidthPreview(null)}>
        Cancel sidebar resize
      </button>
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
          <Route
            path="extensions/app/:extensionId/:commandId"
            element={<Page />}
          />
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
    expect(main).toHaveAttribute("tabindex", "0");
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

  it("侧栏拖动预览同步内容区留白，取消后恢复持久宽度", () => {
    renderShell();
    const shell = screen.getByRole("main").closest(".app-shell");
    expect(shell).toHaveStyle({ "--app-sidebar-width": "224px" });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview sidebar width" }),
    );
    expect(shell).toHaveStyle({ "--app-sidebar-width": "280px" });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel sidebar resize" }),
    );
    expect(shell).toHaveStyle({ "--app-sidebar-width": "224px" });
  });

  it("扩展正文不显示导航标识行，普通页面保留位置上下文", () => {
    renderShell("/extensions/app/example.lab/open");
    expect(screen.getByRole("heading", { name: "Page content" })).toBeVisible();
    expect(document.querySelector(".app-route-context")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "/settings" }));
    expect(
      screen.getByRole("navigation", { name: "navContext.location" }),
    ).toHaveTextContent("nav.settings");
  });

  it("目标页模块未就绪时显示预布局骨架，加载后立即切换", async () => {
    let finish!: (value: { default: typeof Page }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ default: typeof Page }>((resolve) => {
          finish = resolve;
        }),
    );
    const PendingPage = lazy(load);
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Page />} />
            <Route path="settings" element={<PendingPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "/settings" }));
    });
    expect(load).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "Page content" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "common.loading" }),
    ).toBeVisible();
    await act(async () => {
      finish({ default: Page });
    });
    expect(
      screen.queryByRole("status", { name: "common.loading" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "navContext.location" }),
    ).toHaveTextContent("nav.settings");
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
    expect(
      screen.queryByRole("link", { name: "/desktop" }),
    ).not.toBeInTheDocument();
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

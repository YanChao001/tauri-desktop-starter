import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createPortal } from "react-dom";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeIcon } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/providers/i18n";
import { CommandsProvider, useCommands } from "@/providers/commands";
import { zhCN } from "@/i18n/zh-CN";
import { SettingsProvider, STORAGE_KEY } from "@/providers/settings";
import type { AppNavigationItem, AppRoute } from "@/routes";
import {
  ExtensionChromeProvider,
  useExtensionChromeTarget,
} from "@/features/extensions/extension-chrome-slot";
import { AppSidebar } from "./app-sidebar";

vi.mock("@/routes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/routes")>()),
  APP_ROUTES: [],
}));

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
    group: "experience",
    icon: HomeIcon,
    component: () => null,
    exact: true,
  },
];
function PaletteState() {
  const { paletteOpen } = useCommands();
  return <output data-testid="palette-state">{String(paletteOpen)}</output>;
}

function SidebarChrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ExtensionChromeProvider scope={pathname}>
      {children}
    </ExtensionChromeProvider>
  );
}

function SessionTools() {
  const target = useExtensionChromeTarget();
  return target
    ? createPortal(<button>Extension tools</button>, target.node)
    : null;
}

function renderSidebar(
  entries: readonly AppNavigationItem[] = routes,
  initial = "/",
  children: ReactNode = null,
) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <SettingsProvider>
        <I18nProvider>
          <CommandsProvider>
            <TooltipProvider>
              <SidebarChrome>
                <AppSidebar routes={entries} />
                <PaletteState />
                {children}
              </SidebarChrome>
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("preserves navigation layout classes through the Radix tooltip slot", () => {
    renderSidebar();
    const link = screen.getByRole("link", { name: zhCN["nav.overview"] });
    expect(link).toHaveClass("flex", "items-center");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).not.toContain("=>");
  });

  it("places tools beside the active extension link, preserves the destination when collapsed and removes it on navigation", async () => {
    const extension: AppNavigationItem = {
      path: "/extensions/app/example.lab/open",
      group: "extensions",
      labelKey: "ext.title",
      label: "Lab app",
      icon: HomeIcon,
      exact: true,
    };
    renderSidebar(
      [
        routes[0]!,
        extension,
        {
          ...extension,
          path: "/extensions/app/other/open",
          label: "Other app",
        },
      ],
      extension.path,
      <SessionTools />,
    );
    const link = screen.getByRole("link", { name: "Lab app" });
    const tools = screen.getByRole("button", { name: "Extension tools" });
    const slot = tools.parentElement;
    expect(tools.closest("a")).toBeNull();
    expect(slot?.parentElement).toBe(link.parentElement);
    expect(document.querySelectorAll("[data-extension-chrome]")).toHaveLength(
      1,
    );
    fireEvent.click(tools);
    expect(link).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(screen.getByRole("button", { name: "Extension tools" })).toBe(tools);
    expect(tools.parentElement).toBe(slot);
    tools.focus();
    expect(tools).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(tools.parentElement).toBe(slot);
    await act(async () =>
      fireEvent.click(screen.getByRole("link", { name: "Other app" })),
    );
    expect(screen.getByRole("button", { name: "Extension tools" })).not.toBe(
      tools,
    );
    expect(document.querySelectorAll("[data-extension-chrome]")).toHaveLength(
      1,
    );
    expect(
      screen
        .getByRole("button", { name: "Extension tools" })
        .closest("[data-sidebar-extension]"),
    ).toBe(screen.getByRole("link", { name: "Other app" }).parentElement);
    await act(async () =>
      fireEvent.click(screen.getByRole("link", { name: zhCN["nav.overview"] })),
    );
    expect(
      screen.queryByRole("button", { name: "Extension tools" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("[data-extension-chrome]")).toBeNull();
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
  it("preloads the intended page on pointer entry and keyboard focus without navigating", () => {
    const preload = vi.fn();
    renderSidebar([
      routes[0]!,
      { ...routes[0]!, path: "/desktop", labelKey: "nav.desktop", preload },
    ]);
    const link = screen.getByRole("link", { name: zhCN["nav.desktop"] });
    expect(preload).not.toHaveBeenCalled();
    fireEvent.pointerEnter(link);
    expect(preload).toHaveBeenCalledTimes(1);
    fireEvent.focus(link);
    expect(preload).toHaveBeenCalledTimes(2);
    expect(link).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("link", { name: zhCN["nav.overview"] }),
    ).toHaveAttribute("aria-current", "page");
  });
  it("keeps collapsed navigation named and restores the saved width", () => {
    const view = renderSidebar();
    fireEvent.keyDown(screen.getByRole("separator"), {
      key: "ArrowRight",
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(
      screen.getByRole("link", { name: zhCN["nav.overview"] }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: zhCN["nav.overview"] }),
    ).toHaveClass("px-3");
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

  it("折叠不激活展开时的隐藏提示，键盘聚焦一次只显示当前一条", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    renderSidebar([
      routes[0]!,
      {
        ...routes[0]!,
        path: "/desktop",
        labelKey: "nav.desktop",
        group: "capabilities",
      },
    ]);
    const first = screen.getByRole("link", { name: zhCN["nav.overview"] });
    const second = screen.getByRole("link", { name: zhCN["nav.desktop"] });
    fireEvent.focus(first);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(first);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      zhCN["nav.overview"],
    );
    fireEvent.focus(second);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      zhCN["nav.desktop"],
    );
    // 上一项晚到的关闭不能清除当前项；切页则立即卸载提示，防止退出动画残留。
    fireEvent.blur(first);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    await act(async () => fireEvent.click(second));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("marks active pointer resizing for immediate width updates and clears it after release", () => {
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
        }
      },
    );
    renderSidebar();
    const sidebar = screen.getByRole("complementary");
    const separator = screen.getByRole("separator");
    separator.setPointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn(() => true);
    separator.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 2, clientX: 224 });
    expect(sidebar).toHaveAttribute("data-resizing", "true");
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 264 });
    expect(sidebar).toHaveStyle({ width: "264px" });
    fireEvent.pointerUp(separator, { pointerId: 2 });
    expect(sidebar).toHaveAttribute("data-resizing", "false");
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(2);
  });

  it("keeps text in place for fading and exposes reduced-motion preference", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ language: "zh", motion: "reduced" }),
    );
    renderSidebar();
    const sidebar = screen.getByRole("complementary");
    const label = screen
      .getByRole("link", { name: zhCN["nav.overview"] })
      .querySelector("span");
    expect(sidebar).toHaveAttribute("data-motion", "reduced");
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(
      screen
        .getByRole("link", { name: zhCN["nav.overview"] })
        .querySelector("span"),
    ).toBe(label);
    expect(label).not.toHaveClass("sr-only");
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
  });

  it("clears the immediate-resize state when collapsing removes the drag handle", async () => {
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
        }
      },
    );
    renderSidebar();
    const sidebar = screen.getByRole("complementary");
    const separator = screen.getByRole("separator");
    separator.setPointerCapture = vi.fn();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 2, clientX: 224 });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" })),
    );
    expect(sidebar).toHaveAttribute("data-resizing", "false");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "展开侧栏" })),
    );
    expect(sidebar).toHaveAttribute("data-resizing", "false");
  });

  it("groups visible routes by metadata and omits empty groups", () => {
    const view = renderSidebar();
    expect(
      within(
        screen.getByRole("group", { name: zhCN["navGroup.experience"] }),
      ).getByRole("link"),
    ).toHaveAttribute("href", "/");
    expect(
      screen.queryByRole("group", { name: zhCN["navGroup.system"] }),
    ).not.toBeInTheDocument();
    view.unmount();
    renderSidebar([
      {
        ...routes[0]!,
        path: "/settings",
        labelKey: "nav.settings",
        group: "system",
      },
      routes[0]!,
      {
        ...routes[0]!,
        path: "/desktop",
        labelKey: "nav.desktop",
        group: "capabilities",
      },
    ]);
    expect(
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-labelledby")),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/", "/desktop", "/settings"]);
  });

  it("opens the real command palette state from the footer even when collapsed", async () => {
    renderSidebar();
    const commands = screen.getByRole("button", {
      name: new RegExp(`^${zhCN["navContext.commands"]}`),
    });
    expect(commands).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(screen.getByTestId("palette-state")).toHaveTextContent("false");
    await act(async () => fireEvent.click(commands));
    expect(screen.getByTestId("palette-state")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "折叠侧栏" }));
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${zhCN["navContext.commands"]}`),
      }),
    ).toBe(commands);
    await act(async () => fireEvent.click(commands));
    expect(screen.getByTestId("palette-state")).toHaveTextContent("false");
    expect(screen.queryByText("Tauri 2 · React 19")).not.toBeInTheDocument();
  });
});

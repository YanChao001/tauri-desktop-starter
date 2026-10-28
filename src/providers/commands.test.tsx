import { type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { AppCommand } from "@/commands/types";
import { CommandPalette } from "@/components/command-palette";
import { CommandMenuItem } from "@/components/command-menu-item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { I18nProvider } from "@/providers/i18n";
import {
  SettingsProvider,
  STORAGE_KEY,
  useSettings,
} from "@/providers/settings";
import { CommandsProvider, useCommands, useRegisterCommands } from "./commands";

const theme = vi.hoisted(() => ({ setTheme: vi.fn(), toggle: vi.fn() }));
vi.mock("@/hooks/use-theme-switch", () => ({
  useThemeSwitch: () => ({ resolvedTheme: "light", ...theme }),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
  minimizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  quitApp: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/routes", () => ({
  APP_ROUTES: [
    { path: "/", labelKey: "nav.overview", icon: () => null },
    {
      path: "/components",
      labelKey: "nav.components",
      icon: () => null,
      demoOnly: true,
    },
    { path: "/diagnostics", labelKey: "nav.diagnostics", icon: () => null },
    {
      path: "/recovery",
      labelKey: "recovery.title",
      icon: () => null,
      hidden: true,
    },
  ],
}));

function Extensions({ items }: { items: readonly AppCommand[] }) {
  useRegisterCommands(items);
  return null;
}
function Probe() {
  const commands = useCommands();
  const { settings, update } = useSettings();
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="collapsed">
        {String(settings.sidebarCollapsed)}
      </output>
      <output data-testid="location">
        {pathname}
        {search}
      </output>
      <input aria-label="Editor" />
      <button onClick={() => void commands.execute("test")}>
        Run extension
      </button>
      <button onClick={() => void commands.execute("theme-light")}>
        Light
      </button>
      <button onClick={() => void commands.execute("navigate:/")}>Home</button>
      <button onClick={() => void commands.execute("open-desktop")}>
        Window settings
      </button>
      <button onClick={() => void commands.execute("open-window")}>
        Window options
      </button>
      <button onClick={() => void commands.execute("check-updates")}>
        Update settings
      </button>
      <button onClick={() => update({ language: "en" })}>English</button>
      <button onClick={() => update({ appMode: "minimal" })}>Minimal</button>
      <button onClick={() => commands.setPaletteOpen(true)}>Palette</button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button>Actions menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <CommandMenuItem id="test" />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
function Harness({
  children,
  initialPath = "/",
}: {
  children?: ReactNode;
  initialPath?: string;
}) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <SettingsProvider>
        <I18nProvider>
          <CommandsProvider>
            {children}
            <Probe />
            <CommandPalette />
          </CommandsProvider>
        </I18nProvider>
      </SettingsProvider>
    </MemoryRouter>
  );
}

describe("unified application commands", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: "zh" }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shares keyboard actions and protects editing while allowing the palette from inputs", async () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("collapsed")).toHaveTextContent("true");
    const editor = screen.getByRole("textbox", { name: "Editor" });
    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
    fireEvent.keyDown(document.body, {
      key: "b",
      ctrlKey: true,
      isComposing: true,
    });
    expect(screen.getByTestId("collapsed")).toHaveTextContent("true");
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "快速操作" });
    expect(input).toHaveFocus();
    expect(
      screen.queryByRole("option", { name: /最小化/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "theme" } });
    const settingsTheme = await screen.findByRole("option", { name: "主题" });
    fireEvent.click(settingsTheme);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/settings?focus=theme",
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores overridden actions on feature unmount and prevents duplicate in-flight execution", async () => {
    let resolve!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const override = vi.fn();
    const items: AppCommand[] = [
      { id: "test", labelKey: "common.save", group: "tools", run },
      {
        id: "theme-light",
        labelKey: "title.light",
        group: "appearance",
        run: override,
      },
    ];
    const view = render(
      <Harness>
        <Extensions items={items} />
      </Harness>,
    );
    fireEvent.click(screen.getByText("Light"));
    expect(override).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Run extension"));
    fireEvent.click(screen.getByText("Run extension"));
    expect(run).toHaveBeenCalledOnce();
    await act(async () => resolve());
    view.rerender(<Harness />);
    fireEvent.click(screen.getByText("Light"));
    expect(theme.setTheme).toHaveBeenCalledWith("light");
  });

  it("uses the current language when an asynchronous command fails", async () => {
    let reject!: (error: Error) => void;
    const items: AppCommand[] = [
      {
        id: "test",
        labelKey: "common.save",
        group: "tools",
        run: () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      },
    ];
    render(
      <Harness>
        <Extensions items={items} />
      </Harness>,
    );
    fireEvent.click(screen.getByText("Run extension"));
    fireEvent.click(screen.getByText("English"));
    await act(async () => reject(new Error("offline")));
    expect(toast.error).toHaveBeenCalledWith("Operation failed: offline");
  });

  it("updates visible navigation when the app switches to minimal mode", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Minimal"));
    fireEvent.click(screen.getByText("Palette"));
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("option", { name: "交互体验" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "创意展厅" })).toBeVisible();
  });
  it("opens shared settings from desktop and browser window commands", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Window settings"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings?section=desktop",
    );
    fireEvent.click(screen.getByText("Window options"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings?focus=windows",
    );
    fireEvent.click(screen.getByText("Update settings"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings?section=updates",
    );
  });
  it("finds the combined recovery destination without exposing the legacy recovery command", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Palette"));
    const input = await screen.findByRole("combobox", { name: "快速操作" });
    fireEvent.change(input, { target: { value: "恢复" } });
    const destination = await screen.findByRole("option", {
      name: "诊断与恢复",
    });
    expect(
      screen.queryByRole("option", { name: "启动故障恢复" }),
    ).not.toBeInTheDocument();
    fireEvent.click(destination);
    expect(screen.getByTestId("location")).toHaveTextContent("/diagnostics");
  });

  it("keeps standalone extension sessions out of host navigation and its shortcuts", () => {
    const path = "/extension-window/starter.apps/calculator";
    render(<Harness initialPath={path} />);
    fireEvent.keyDown(document.body, { key: ",", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    fireEvent.click(screen.getByText("Home"));
    expect(screen.getByTestId("location")).toHaveTextContent(path);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("collapsed")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("Light"));
    expect(theme.setTheme).toHaveBeenCalledWith("light");
  });

  it("dispatches registered commands from menus with the same availability", async () => {
    const run = vi.fn();
    const items: AppCommand[] = [
      { id: "test", labelKey: "common.save", group: "tools", run },
    ];
    render(
      <Harness>
        <Extensions items={items} />
      </Harness>,
    );
    fireEvent.keyDown(screen.getByText("Actions menu"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "保存" }));
    expect(run).toHaveBeenCalledOnce();
  });
});

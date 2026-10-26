import { StrictMode } from "react";
import { createPortal } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandsProvider } from "@/providers/commands";
import { APP_CONFIG } from "@/config/app";
import appIcon from "../../resources/branding/app-icon.svg";
import {
  onWindowResized,
  isWindowMaximized,
  closeWindow,
  quitApp,
  minimizeWindow,
  toggleMaximizeWindow,
} from "@/lib/tauri";
import { TitleBar } from "./title-bar";
import {
  ExtensionChromeProvider,
  useExtensionChromeTarget,
} from "@/features/extensions/extension-chrome-slot";

vi.mock("@/routes", () => ({ APP_ROUTES: [] }));
vi.mock("@/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ fullscreen: false, change: vi.fn() }),
}));

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  isWindowMaximized: vi.fn().mockResolvedValue(false),
  onWindowResized: vi.fn(),
  closeWindow: vi.fn(),
  quitApp: vi.fn(),
  minimizeWindow: vi.fn(),
  openExternal: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { menuBar: true }, update: vi.fn() }),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
const theme = vi.hoisted(() => ({ setTheme: vi.fn(), toggle: vi.fn() }));
vi.mock("@/hooks/use-theme-switch", () => ({
  useThemeSwitch: () => ({
    theme: "light",
    ...theme,
  }),
}));

function TestTools() {
  const target = useExtensionChromeTarget();
  return target
    ? createPortal(<button>Extension tools</button>, target.node)
    : null;
}
function renderTitleBar(
  standalone = false,
  extension?: { name: string; icon: "calculator" },
) {
  return render(
    <StrictMode>
      <MemoryRouter
        initialEntries={[standalone ? "/extension-window/test/open" : "/"]}
      >
        <TooltipProvider>
          <CommandsProvider>
            <ExtensionChromeProvider
              scope={standalone ? "/extension-window/test/open" : "/"}
            >
              <TitleBar standalone={standalone} extension={extension} />
              {extension ? <TestTools /> : null}
            </ExtensionChromeProvider>
          </CommandsProvider>
        </TooltipProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("TitleBar 窗口订阅", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("StrictMode 清理后才完成的异步订阅也会被取消", async () => {
    const pending: Array<(stop: () => void) => void> = [];
    vi.mocked(onWindowResized).mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const { unmount } = renderTitleBar();
    await waitFor(() => expect(pending).toHaveLength(2));
    const stops = pending.map(() => vi.fn());
    await act(async () =>
      pending.forEach((resolve, index) => resolve(stops[index]!)),
    );
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).not.toHaveBeenCalled();
    unmount();
    expect(stops[1]).toHaveBeenCalledOnce();
  });

  it("resize 回调读取窗口状态失败时有兜底", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(onWindowResized).mockResolvedValue(vi.fn());
    renderTitleBar();
    await act(async () => {});
    vi.mocked(isWindowMaximized).mockRejectedValueOnce(new Error("IPC failed"));
    const handler = vi.mocked(onWindowResized).mock.calls.at(-1)?.[0];
    await act(async () => handler?.());
    expect(warn).toHaveBeenCalledWith("读取窗口状态失败", expect.any(Error));
  });

  it("较慢的旧查询不会覆盖最近一次 resize 的窗口状态", async () => {
    vi.mocked(onWindowResized).mockResolvedValue(vi.fn());
    const pending: Array<(value: boolean) => void> = [];
    vi.mocked(isWindowMaximized).mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    renderTitleBar();
    await act(async () => {});
    const handler = vi.mocked(onWindowResized).mock.calls.at(-1)?.[0];
    act(() => handler?.());
    await act(async () => pending.at(-1)?.(true));
    expect(screen.getByRole("button", { name: "title.restore" })).toBeVisible();
    await act(async () => pending.forEach((resolve) => resolve(false)));
    expect(screen.getByRole("button", { name: "title.restore" })).toBeVisible();
  });

  it("订阅就绪后读取窗口状态，并忽略已清理的 resize 回调", async () => {
    const registrations: Array<(stop: () => void) => void> = [];
    vi.mocked(onWindowResized).mockImplementation(
      () => new Promise((resolve) => registrations.push(resolve)),
    );
    vi.mocked(isWindowMaximized).mockResolvedValue(true);
    renderTitleBar();
    expect(isWindowMaximized).not.toHaveBeenCalled();
    await act(async () => registrations.forEach((resolve) => resolve(vi.fn())));
    expect(screen.getByRole("button", { name: "title.restore" })).toBeVisible();
    expect(isWindowMaximized).toHaveBeenCalledOnce();
    const stale = vi.mocked(onWindowResized).mock.calls[0]?.[0];
    await act(async () => stale?.());
    expect(isWindowMaximized).toHaveBeenCalledOnce();
  });

  it("keeps close-window separate from explicit application quit", async () => {
    vi.mocked(onWindowResized).mockResolvedValue(vi.fn());
    vi.mocked(isWindowMaximized).mockResolvedValue(false);
    renderTitleBar();
    fireEvent.click(screen.getByRole("button", { name: "title.close" }));
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(quitApp).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "title.file" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "title.quit" }),
    );
    expect(quitApp).toHaveBeenCalledOnce();
  });

  it("shows the shared brand icon without repeating the application name as title text", () => {
    vi.mocked(onWindowResized).mockResolvedValue(vi.fn());
    vi.mocked(isWindowMaximized).mockResolvedValue(false);
    renderTitleBar();
    const icon = screen.getByRole("img", { name: APP_CONFIG.name });
    expect(icon).toHaveAttribute("src", appIcon);
    expect(icon).toHaveAttribute("width", "24");
    expect(screen.queryByText(APP_CONFIG.name)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "title.file" })).toBeVisible();
  });

  it("keeps language, theme and native controls without host navigation in a standalone window", () => {
    vi.mocked(onWindowResized).mockResolvedValue(vi.fn());
    renderTitleBar(true);
    expect(
      document.querySelector("[data-extension-window-title]"),
    ).toHaveTextContent("ext.title");
    expect(screen.queryByRole("button", { name: "title.file" })).toBeNull();
    expect(screen.queryByRole("button", { name: "commands.open" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "title.toggleTheme" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "common.language" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "title.toggleTheme" }));
    expect(theme.toggle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "title.minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "title.maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "title.close" }));
    expect(minimizeWindow).toHaveBeenCalledOnce();
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(quitApp).not.toHaveBeenCalled();
  });

  it("uses the extension identity and places its tools between theme and native window controls", () => {
    vi.mocked(onWindowResized).mockResolvedValue(vi.fn());
    renderTitleBar(true, { name: "Scientific calculator", icon: "calculator" });
    const icon = screen.getByRole("img", { name: "Scientific calculator" });
    expect(icon.querySelector("svg")).toHaveClass("lucide-calculator");
    expect(
      screen.queryByRole("img", { name: APP_CONFIG.name }),
    ).not.toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    const themeIndex = buttons.indexOf(
      screen.getByRole("button", { name: "title.toggleTheme" }),
    );
    const toolsIndex = buttons.indexOf(
      screen.getByRole("button", { name: "Extension tools" }),
    );
    const minimizeIndex = buttons.indexOf(
      screen.getByRole("button", { name: "title.minimize" }),
    );
    expect(themeIndex).toBeLessThan(toolsIndex);
    expect(toolsIndex).toBeLessThan(minimizeIndex);
    const title = screen.getByText("Scientific calculator");
    expect(title).toHaveAttribute("data-extension-window-title");
    expect(title).toHaveAttribute("title", "Scientific calculator");
    expect(title).toHaveAttribute("data-tauri-drag-region");
    expect(title).toHaveClass("truncate");
  });
});

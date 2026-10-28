import { STORAGE_KEY } from "@/lib/settings-model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/providers/i18n";
import { DEFAULT_SETTINGS, SettingsProvider } from "@/providers/settings";
import Settings from "./settings";
import { SETTINGS_VERSION } from "@/lib/settings-model";
import { settingsDocument } from "@/lib/settings-model";
import * as desktop from "@/lib/tauri";
import { toast } from "sonner";

function SettingsView({ initial = "/settings" }: { initial?: string }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <SettingsProvider>
        <I18nProvider>
          <Settings />
        </I18nProvider>
      </SettingsProvider>
    </MemoryRouter>
  );
}

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => false),
  getAppInfo: vi.fn(),
  openExternal: vi.fn(),
  getWindowGeometry: vi.fn(),
  setWindowSize: vi.fn(),
  resetWindowGeometry: vi.fn(),
  onWindowResized: vi.fn(),
  onWindowMoved: vi.fn(),
  loadSettingsSnapshot: vi.fn(),
  saveSettingsSnapshot: vi.fn(),
  onSettingsChanged: vi.fn(),
  getDesktopStatus: vi.fn(),
  getAutostartEnabled: vi.fn(),
  setAutostartEnabled: vi.fn(),
  openSecondaryWindow: vi.fn(),
  checkForUpdate: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  getUpdateSnapshot: vi.fn(),
  onUpdateProgress: vi.fn(),
  relaunchApp: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/wallpaper-library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wallpaper-library")>()),
  listWallpaperLibrary: vi.fn().mockResolvedValue([]),
  onWallpaperLibraryChanged: vi.fn().mockResolvedValue(() => {}),
}));

const geometry: desktop.WindowGeometry = {
  width: 1120,
  height: 740,
  minWidth: 880,
  minHeight: 600,
  maxWidth: 1920,
  maxHeight: 1040,
  defaultWidth: 1120,
  defaultHeight: 740,
};

function confirmReset() {
  fireEvent.click(screen.getByRole("button", { name: "重置偏好" }));
  return within(screen.getByRole("dialog"));
}

describe("设置页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(desktop.isTauri).mockReturnValue(false);
    vi.mocked(desktop.getAppInfo).mockResolvedValue({
      version: "0.1.0",
      tauriVersion: "2.0.0",
    });
    vi.mocked(desktop.getDesktopStatus).mockResolvedValue({
      autostartSupported: true,
      trayAvailable: true,
      secondaryOpen: false,
      runInBackground: false,
    });
    vi.mocked(desktop.getAutostartEnabled).mockResolvedValue(false);
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue(geometry);
    vi.mocked(desktop.setWindowSize).mockImplementation(
      async (width, height) => ({ ...geometry, width, height }),
    );
    vi.mocked(desktop.resetWindowGeometry).mockResolvedValue(geometry);
    vi.mocked(desktop.onWindowResized).mockResolvedValue(vi.fn());
    vi.mocked(desktop.onWindowMoved).mockResolvedValue(vi.fn());
    vi.mocked(desktop.onSettingsChanged).mockResolvedValue(vi.fn());
    vi.mocked(desktop.loadSettingsSnapshot).mockResolvedValue({
      revision: 1,
      settings: settingsDocument(DEFAULT_SETTINGS),
    });
    vi.mocked(desktop.saveSettingsSnapshot).mockImplementation(
      async (settings, revision) => ({
        revision: revision + 1,
        settings: settings as desktop.SettingsSnapshot["settings"],
      }),
    );
    window.localStorage.clear();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ language: "zh" }),
    );
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
  it("关于资源保留真实链接地址与浏览器新标签页语义", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByText("关于与资源"));
    const link = screen.getByRole("link", { name: /^Tauri / });
    expect(link).toHaveAttribute("href", "https://v2.tauri.app/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("link", { name: /^Tailwind CSS / }),
    ).toHaveAttribute("href", "https://tailwindcss.com/");
    expect(desktop.openExternal).not.toHaveBeenCalled();
  });
  it("网络位于设置末段并提供连接深链，浏览器禁用修改且按需说明连接由浏览器控制", async () => {
    render(<SettingsView initial="/settings?focus=networkMode" />);
    expect(screen.getByText("网络", { exact: true })).toBeVisible();
    expect(
      screen
        .getAllByText(/^(应用更新|网络|关于与资源)$/)
        .map((element) => element.textContent),
    ).toEqual(["应用更新", "网络", "关于与资源"]);
    expect(document.getElementById("settings-networkMode")).toHaveFocus();
    const connection = screen.getByRole("combobox", { name: "网络连接" });
    expect(connection).toBeDisabled();
    expect(connection).toHaveTextContent("跟随系统代理");
    expect(screen.queryByText(/连接方式由浏览器控制/)).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: "了解网络连接" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "连接方式由浏览器控制，请在桌面应用中修改此设置。",
    );
    expect(desktop.saveSettingsSnapshot).not.toHaveBeenCalled();
  });

  it("桌面网络连接通过宿主设置保存，可在直连和系统代理间切换", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    render(<SettingsView />);
    await screen.findByText("当前尺寸 1120 × 740");
    const connection = screen.getByRole("combobox", { name: "网络连接" });
    expect(connection).toBeEnabled();
    fireEvent.keyDown(connection, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "直接连接" }));
    await waitFor(() =>
      expect(
        vi.mocked(desktop.saveSettingsSnapshot).mock.calls.at(-1)?.[0],
      ).toMatchObject({ networkMode: "direct" }),
    );
    expect(connection).toHaveTextContent("直接连接");
    fireEvent.keyDown(connection, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "跟随系统代理" }));
    await waitFor(() =>
      expect(
        vi.mocked(desktop.saveSettingsSnapshot).mock.calls.at(-1)?.[0],
      ).toMatchObject({ networkMode: "system" }),
    );
    expect(connection).toHaveTextContent("跟随系统代理");
    fireEvent.focus(screen.getByRole("button", { name: "了解网络连接" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "保存后用于后续网络请求。插件使用系统代理仍需单独授权。",
    );
  });

  it("应用更新直接可见并支持深链定位，浏览器不会调用原生更新", () => {
    render(<SettingsView initial="/settings?section=updates" />);
    expect(screen.getByRole("region", { name: "应用更新" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "启动时检查更新" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/更新检查、安装和自动检查仅在桌面应用中可用/),
    ).toBeVisible();
    expect(desktop.checkForUpdate).not.toHaveBeenCalled();
    expect(desktop.downloadAndInstallUpdate).not.toHaveBeenCalled();
    expect(desktop.getUpdateSnapshot).not.toHaveBeenCalled();
    expect(desktop.onUpdateProgress).not.toHaveBeenCalled();
  });
  it("把桌面选项放在窗口设置中，浏览器明确限制且别名定位可聚焦", () => {
    render(<SettingsView initial="/settings?section=desktop" />);
    expect(screen.getByRole("region", { name: "窗口与运行" })).toHaveFocus();
    expect(
      screen.getByText(/登录启动、后台运行和多窗口需要桌面应用/),
    ).toBeVisible();
    expect(screen.getByRole("switch", { name: "登录时启动" })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "关闭窗口后在后台运行" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "打开第二个窗口" }),
    ).toBeDisabled();
    expect(screen.getByRole("group", { name: "窗口大小" })).toBeVisible();
  });

  it("提供语言切换入口并将新语言写入文档和存档", () => {
    render(<SettingsView />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "语言" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("English");
    expect(document.documentElement.lang).toBe("en");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject(
      { language: "en" },
    );
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("重置外观时保留用户语言并恢复其余默认偏好", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        language: "en",
        accent: "rose",
        font: "mono",
        motion: "reduced",
        menuBar: false,
        background: "sakura",
        backgroundIntensity: "strong",
      }),
    );
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Reset preferences" }));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject(
      { accent: "rose", font: "mono" },
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject(
      { accent: "rose", font: "mono" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset preferences" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reset preferences",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
      schemaVersion: SETTINGS_VERSION,
      ...DEFAULT_SETTINGS,
      language: "en",
    });
  });

  it("皮肤与强度即时生效、持久化，并在纯色皮肤下禁用强度", () => {
    const view = () => <SettingsView />;
    const { unmount } = render(view());
    expect(screen.getByRole("slider", { name: "皮肤强度" })).toHaveAttribute(
      "data-disabled",
    );
    fireEvent.click(screen.getByRole("radio", { name: "云朵晴空" }));
    const slider = screen.getByRole("slider", { name: "皮肤强度" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "60");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(document.documentElement).toHaveAttribute(
      "data-background",
      "sakura",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-background-intensity",
      "0",
    );
    unmount();
    render(view());
    expect(screen.getByRole("radio", { name: "云朵晴空" })).toBeChecked();
    expect(screen.getByRole("slider", { name: "皮肤强度" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "皮肤强度" }), {
      key: "End",
    });
    expect(screen.getByRole("slider", { name: "皮肤强度" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    fireEvent.click(screen.getByRole("radio", { name: "纯色" }));
    expect(screen.getByRole("slider", { name: "皮肤强度" })).toHaveAttribute(
      "data-disabled",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-background",
      "plain",
    );
  });

  it("皮肤说明保留无障碍关联，键盘聚焦后才显示补充文案", async () => {
    render(<SettingsView />);
    const skin = screen.getByRole("radio", { name: "云朵晴空" });
    expect(skin).toHaveAccessibleDescription(
      "蓬松云团与小太阳，像随手画下的好天气",
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(skin);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "蓬松云团与小太阳，像随手画下的好天气",
    );
  });

  it("首次读取窗口范围失败保留紧凑恢复入口，重试后恢复预设", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.getWindowGeometry)
      .mockRejectedValueOnce({ code: "WINDOW_ERROR" })
      .mockResolvedValueOnce(geometry);
    render(<SettingsView />);
    expect(await screen.findByRole("alert")).toBeVisible();
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("当前尺寸 1120 × 740");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toBeEnabled();
  });

  it("浏览器预览禁用原生尺寸预设，环境说明按需展示且允许保存启动位置偏好", async () => {
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    expect(
      presets.getByRole("button", { name: "紧凑 960 × 640" }),
    ).toBeDisabled();
    expect(
      presets.getByRole("button", { name: "标准 应用默认尺寸" }),
    ).toBeDisabled();
    expect(
      presets.getByRole("button", { name: "舒适 1280 × 800" }),
    ).toBeDisabled();
    expect(
      presets.getByRole("button", { name: "宽敞 1440 × 900" }),
    ).toBeDisabled();
    for (const button of presets.getAllByRole("button"))
      expect(button).toBeDisabled();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "应用窗口大小" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("窗口大小由桌面应用管理，浏览器预览中不可修改。"),
    ).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: "了解窗口大小" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "窗口大小由桌面应用管理，浏览器预览中不可修改。",
    );
    expect(desktop.getWindowGeometry).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "记住上次位置" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "居中" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      windowPosition: "center",
    });
    expect(desktop.setWindowSize).not.toHaveBeenCalled();
    expect(desktop.resetWindowGeometry).not.toHaveBeenCalled();
  });

  it("选择预设立即应用，显示原生返回的实际尺寸且不强制匹配预设", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.setWindowSize).mockResolvedValue({
      ...geometry,
      width: 1272,
      height: 792,
    });
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    await waitFor(() =>
      expect(
        presets.getByRole("button", {
          name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
        }),
      ).toBeEnabled(),
    );
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      presets.getByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("窗口大小已保存"),
    );
    expect(desktop.setWindowSize).toHaveBeenCalledExactlyOnceWith(1280, 800);
    expect(screen.getByText("当前尺寸 1272 × 792")).toBeVisible();
    for (const button of presets.getAllByRole("button"))
      expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("窗口监听就绪后读取尺寸，覆盖监听注册期间的变化", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    let finishResize!: (stop: () => void) => void;
    let finishMove!: (stop: () => void) => void;
    vi.mocked(desktop.onWindowResized).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishResize = resolve;
        }),
    );
    vi.mocked(desktop.onWindowMoved).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishMove = resolve;
        }),
    );
    render(<SettingsView />);
    expect(desktop.getWindowGeometry).not.toHaveBeenCalled();
    await act(async () => finishResize(vi.fn()));
    expect(desktop.getWindowGeometry).not.toHaveBeenCalled();
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1280,
      height: 800,
    });
    await act(async () => finishMove(vi.fn()));
    expect(screen.getByText("当前尺寸 1280 × 800")).toBeVisible();
    expect(desktop.getWindowGeometry).toHaveBeenCalledOnce();
  });

  it("禁用超出屏幕范围的固定档位，标准尺寸随屏幕范围适配", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1000,
      height: 700,
      maxWidth: 1000,
      maxHeight: 700,
    });
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    await waitFor(() =>
      expect(
        presets.getByRole("button", { name: /^紧凑 960 × 640(?: |$)/ }),
      ).toBeEnabled(),
    );
    expect(
      presets.getByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    ).toBeDisabled();
    expect(
      presets.getByRole("button", { name: /^宽敞 1440 × 900(?: |$)/ }),
    ).toBeDisabled();
    expect(
      presets.getByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    ).toHaveAccessibleDescription("不符合当前屏幕可用范围");
    const disabledReason = presets.getByRole("group", { name: "舒适" });
    expect(disabledReason).toHaveAttribute("tabindex", "0");
    fireEvent.focus(disabledReason);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "不符合当前屏幕可用范围",
    );
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toHaveTextContent("1000 × 700");
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toHaveTextContent("已适应当前屏幕");
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toBeEnabled();
    fireEvent.click(
      presets.getByRole("button", { name: /^宽敞 1440 × 900(?: |$)/ }),
    );
    expect(desktop.setWindowSize).not.toHaveBeenCalled();
  });

  it("全部固定档位越界时标准仍可选，并使用适配后的尺寸", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 920,
      height: 590,
      minHeight: 500,
      maxWidth: 920,
      maxHeight: 590,
    });
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    const standard = presets.getByRole("button", {
      name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
    });
    await waitFor(() => expect(standard).toBeEnabled());
    for (const name of [
      /^紧凑 960 × 640/,
      /^舒适 1280 × 800/,
      /^宽敞 1440 × 900/,
    ])
      expect(presets.getByRole("button", { name })).toBeDisabled();
    expect(standard).toHaveTextContent("920 × 590");
    fireEvent.click(standard);
    await waitFor(() =>
      expect(desktop.setWindowSize).toHaveBeenCalledExactlyOnceWith(920, 590),
    );
  });

  it("标准尺寸使用品牌配置，并消除与固定预设重复的选项", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1280,
      height: 800,
      defaultWidth: 1280,
      defaultHeight: 800,
    });
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    await waitFor(() =>
      expect(
        presets.getByRole("button", {
          name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
        }),
      ).toBeEnabled(),
    );
    expect(presets.getAllByRole("button")).toHaveLength(3);
    expect(
      presets.queryByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    ).not.toBeInTheDocument();
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toHaveTextContent("1280 × 800");
    expect(
      presets.getByRole("button", {
        name: /^标准 (?:\d+ × \d+|应用默认尺寸)(?: |$)/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("手动调整窗口后刷新当前尺寸，不自动选择最接近的预设", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    let resized!: () => void;
    vi.mocked(desktop.onWindowResized).mockImplementation(async (handler) => {
      resized = handler;
      return vi.fn<() => void>();
    });
    render(<SettingsView />);
    await screen.findByText("当前尺寸 1120 × 740");
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1070,
      height: 705,
    });
    act(() => resized());
    await screen.findByText("当前尺寸 1070 × 705");
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    for (const button of presets.getAllByRole("button"))
      expect(button).toHaveAttribute("aria-pressed", "false");
    expect(desktop.setWindowSize).not.toHaveBeenCalled();
  });

  it("应用尺寸期间阻止重复操作，失败通过toast提供刷新且不插入错误横幅", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    let rejectSize!: (error: unknown) => void;
    vi.mocked(desktop.setWindowSize).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSize = reject;
        }),
    );
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    await waitFor(() =>
      expect(
        presets.getByRole("button", { name: /^紧凑 960 × 640(?: |$)/ }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      presets.getByRole("button", { name: /^紧凑 960 × 640(?: |$)/ }),
    );
    fireEvent.click(
      presets.getByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    );
    expect(desktop.setWindowSize).toHaveBeenCalledExactlyOnceWith(960, 640);
    expect(
      presets.getByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    ).toBeDisabled();
    await act(async () => rejectSize({ code: "WINDOW_ERROR" }));
    expect(toast.error).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("当前尺寸 1120 × 740")).toBeVisible();
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1000,
      height: 700,
      maxWidth: 1000,
      maxHeight: 700,
    });
    const refresh = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action as
      { label: string; onClick(): void } | undefined;
    expect(refresh?.label).toBe("刷新");
    await act(async () => refresh?.onClick());
    await screen.findByText("当前尺寸 1000 × 700");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      presets.getByRole("button", { name: /^舒适 1280 × 800(?: |$)/ }),
    ).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("启动位置通过普通设置同步保存，不移动已打开的窗口", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    render(<SettingsView />);
    await screen.findByText("当前尺寸 1120 × 740");
    fireEvent.click(screen.getByRole("radio", { name: "居中" }));
    await waitFor(() =>
      expect(desktop.saveSettingsSnapshot).toHaveBeenCalled(),
    );
    expect(
      vi.mocked(desktop.saveSettingsSnapshot).mock.calls.at(-1)?.[0],
    ).toMatchObject({
      windowPosition: "center",
    });
    expect(screen.getByRole("radio", { name: "居中" })).toBeChecked();
    expect(desktop.setWindowSize).not.toHaveBeenCalled();
    expect(desktop.resetWindowGeometry).not.toHaveBeenCalled();
  });

  it("恢复默认大小并保留当前位置，等待偏好持久化成功后才关闭确认框", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.loadSettingsSnapshot).mockResolvedValue({
      revision: 1,
      settings: settingsDocument({
        ...DEFAULT_SETTINGS,
        windowPosition: "center",
      }),
    });
    let finishSave!: (snapshot: desktop.SettingsSnapshot) => void;
    vi.mocked(desktop.saveSettingsSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    render(<SettingsView />);
    await screen.findByText("当前尺寸 1120 × 740");
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "居中" })).toBeChecked(),
    );
    const dialog = confirmReset();
    expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "重置偏好" }));
    await waitFor(() =>
      expect(desktop.saveSettingsSnapshot).toHaveBeenCalledOnce(),
    );
    expect(desktop.resetWindowGeometry).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
    expect(
      vi.mocked(desktop.saveSettingsSnapshot).mock.calls[0]?.[0],
    ).toMatchObject({
      windowPosition: "remember",
    });
    await act(async () =>
      finishSave({ revision: 2, settings: settingsDocument(DEFAULT_SETTINGS) }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("radio", { name: "记住上次位置" })).toBeChecked();
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("已恢复默认偏好");
  });

  it("原生重置失败时保留确认和实际尺寸，不写入偏好", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1280,
      height: 800,
    });
    vi.mocked(desktop.resetWindowGeometry).mockRejectedValue({
      code: "WINDOW_ERROR",
    });
    render(<SettingsView />);
    await screen.findByText("当前尺寸 1280 × 800");
    const dialog = confirmReset();
    fireEvent.click(dialog.getByRole("button", { name: "重置偏好" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(desktop.resetWindowGeometry).toHaveBeenCalledExactlyOnceWith(false);
    expect(desktop.saveSettingsSnapshot).not.toHaveBeenCalled();
    expect(screen.getByText("当前尺寸 1280 × 800")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("偏好保存失败保留确认框，尺寸仍显示已成功重置的实际值", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1280,
      height: 800,
    });
    vi.mocked(desktop.saveSettingsSnapshot).mockRejectedValue({
      code: "STORAGE_IO",
    });
    render(<SettingsView />);
    await screen.findByText("当前尺寸 1280 × 800");
    const dialog = confirmReset();
    fireEvent.click(dialog.getByRole("button", { name: "重置偏好" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("当前尺寸 1120 × 740")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

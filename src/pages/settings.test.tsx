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

function SettingsView() {
  return (
    <MemoryRouter>
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
    expect(screen.getByRole("radio", { name: "轻盈" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "云朵晴空" }));
    fireEvent.click(screen.getByRole("radio", { name: "鲜明" }));
    expect(document.documentElement).toHaveAttribute(
      "data-background",
      "sakura",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-background-intensity",
      "strong",
    );
    unmount();
    render(view());
    expect(screen.getByRole("radio", { name: "云朵晴空" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "鲜明" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "纯色" }));
    expect(screen.getByRole("radio", { name: "鲜明" })).toBeDisabled();
    expect(document.documentElement).toHaveAttribute(
      "data-background",
      "plain",
    );
  });

  it("浏览器预览禁用原生尺寸预设，但允许保存启动位置偏好", () => {
    render(<SettingsView />);
    const presets = within(screen.getByRole("group", { name: "窗口大小" }));
    for (const button of presets.getAllByRole("button"))
      expect(button).toBeDisabled();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "应用窗口大小" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("窗口大小由桌面应用管理，浏览器预览中不可修改。"),
    ).toBeVisible();
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
      expect(presets.getByRole("button", { name: "标准" })).toBeEnabled(),
    );
    expect(presets.getByRole("button", { name: "标准" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(presets.getByRole("button", { name: "舒适" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("窗口大小已保存"),
    );
    expect(desktop.setWindowSize).toHaveBeenCalledExactlyOnceWith(1280, 800);
    expect(screen.getByText("当前尺寸 1272 × 792")).toBeVisible();
    for (const button of presets.getAllByRole("button"))
      expect(button).toHaveAttribute("aria-pressed", "false");
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
      expect(presets.getByRole("button", { name: "紧凑" })).toBeEnabled(),
    );
    expect(presets.getByRole("button", { name: "舒适" })).toBeDisabled();
    expect(presets.getByRole("button", { name: "宽敞" })).toBeDisabled();
    expect(
      presets.getByRole("button", { name: "舒适" }),
    ).toHaveAccessibleDescription("不符合当前屏幕可用范围");
    expect(presets.getByRole("button", { name: "标准" })).toHaveTextContent(
      "1000 × 700",
    );
    expect(presets.getByRole("button", { name: "标准" })).toHaveTextContent(
      "已适应当前屏幕",
    );
    expect(presets.getByRole("button", { name: "标准" })).toBeEnabled();
    fireEvent.click(presets.getByRole("button", { name: "宽敞" }));
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
    const standard = presets.getByRole("button", { name: "标准" });
    await waitFor(() => expect(standard).toBeEnabled());
    for (const name of ["紧凑", "舒适", "宽敞"])
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
      expect(presets.getByRole("button", { name: "标准" })).toBeEnabled(),
    );
    expect(presets.getAllByRole("button")).toHaveLength(3);
    expect(
      presets.queryByRole("button", { name: "舒适" }),
    ).not.toBeInTheDocument();
    expect(presets.getByRole("button", { name: "标准" })).toHaveTextContent(
      "1280 × 800",
    );
    expect(presets.getByRole("button", { name: "标准" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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

  it("应用尺寸期间阻止重复操作，原生失败后可刷新范围恢复", async () => {
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
      expect(presets.getByRole("button", { name: "紧凑" })).toBeEnabled(),
    );
    fireEvent.click(presets.getByRole("button", { name: "紧凑" }));
    fireEvent.click(presets.getByRole("button", { name: "舒适" }));
    expect(desktop.setWindowSize).toHaveBeenCalledExactlyOnceWith(960, 640);
    expect(presets.getByRole("button", { name: "舒适" })).toBeDisabled();
    await act(async () => rejectSize({ code: "WINDOW_ERROR" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByText("当前尺寸 1120 × 740")).toBeVisible();
    vi.mocked(desktop.getWindowGeometry).mockResolvedValue({
      ...geometry,
      width: 1000,
      height: 700,
      maxWidth: 1000,
      maxHeight: 700,
    });
    fireEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "重试" }),
    );
    await screen.findByText("当前尺寸 1000 × 700");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(presets.getByRole("button", { name: "舒适" })).toBeDisabled();
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
    await waitFor(() => expect(dialog.getByRole("alert")).toBeVisible());
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
    await waitFor(() => expect(dialog.getByRole("alert")).toBeVisible());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("当前尺寸 1120 × 740")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

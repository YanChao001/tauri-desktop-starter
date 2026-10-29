import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  BackgroundImageError,
  importBackgroundImage,
  type CustomBackground,
} from "@/lib/background-image";
import type { Background } from "@/lib/backgrounds";
import type { Wallpaper } from "@/lib/wallpaper-library";
import { BackgroundVideoError } from "@/lib/video-wallpaper";
import { CustomBackgroundPicker } from "./custom-background-picker";

const state = vi.hoisted(() => ({
  settings: { background: "plain", customBackground: null } as {
    background: Background;
    customBackground: CustomBackground | null;
  },
  update: vi.fn(),
  persistence: "saved",
}));
const library = vi.hoisted(() => ({
  listWallpaperLibrary: vi.fn(),
  addLibraryWallpaper: vi.fn(),
  removeLibraryWallpaper: vi.fn(),
  renameLibraryWallpaper: vi.fn(),
  onWallpaperLibraryChanged: vi.fn(),
}));
const videoImport = vi.hoisted(() => ({
  native: false,
  importVideoWallpaper: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({ isTauri: () => videoImport.native }));
vi.mock("@/lib/video-wallpaper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video-wallpaper")>()),
  importVideoWallpaper: videoImport.importVideoWallpaper,
}));
vi.mock("@/providers/settings", () => ({ useSettings: () => state }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key + (values?.name ? ": " + values.name : ""),
  }),
}));
vi.mock("@/lib/background-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/background-image")>()),
  importBackgroundImage: vi.fn(),
}));
vi.mock("@/lib/wallpaper-library", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wallpaper-library")>()),
  ...library,
}));
const image: CustomBackground = {
  name: "sky.webp",
  dataUrl: "data:image/webp;base64," + btoa("RIFF0000WEBP"),
  fit: "cover",
};
const wallpaper: Wallpaper = {
  id: "a".repeat(64),
  name: image.name,
  dataUrl: image.dataUrl,
};
const file = (name = "sky.png") =>
  new File(["png fixture"], name, { type: "image/png" });
async function loaded() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "settings.importBackground" }),
    ).toBeEnabled(),
  );
}
function choose(files = [file()]) {
  fireEvent.change(screen.getByLabelText("settings.importBackground"), {
    target: { files },
  });
}
beforeEach(() => {
  state.settings = { background: "plain", customBackground: null };
  state.persistence = "saved";
  vi.clearAllMocks();
  videoImport.native = false;
  videoImport.importVideoWallpaper.mockResolvedValue(null);
  library.listWallpaperLibrary.mockResolvedValue([]);
  library.onWallpaperLibraryChanged.mockResolvedValue(vi.fn());
  library.addLibraryWallpaper.mockResolvedValue(wallpaper);
  library.removeLibraryWallpaper.mockResolvedValue(undefined);
  library.renameLibraryWallpaper.mockResolvedValue({
    ...wallpaper,
    name: "Renamed",
  });
  vi.mocked(importBackgroundImage).mockResolvedValue(image);
});
afterEach(cleanup);

describe("多图壁纸图库", () => {
  it("浏览器混合导入图片与视频，保存封面和视频引用后再应用", async () => {
    const video = { id: "c".repeat(64), mime: "video/webm" as const };
    const imported = { ...image, name: "clouds.webm", video };
    const saved = { ...wallpaper, id: "b".repeat(64), ...imported };
    const selected = new File(["video fixture"], "clouds.webm", {
      type: "video/webm",
    });
    videoImport.importVideoWallpaper.mockResolvedValue(imported);
    library.addLibraryWallpaper
      .mockResolvedValueOnce(wallpaper)
      .mockResolvedValueOnce(saved);
    render(<CustomBackgroundPicker />);
    await loaded();
    choose([file(), selected]);
    const wallpapers = within(
      screen.getByRole("group", { name: "settings.bgCustom" }),
    );
    await waitFor(() =>
      expect(wallpapers.getAllByRole("radio")).toHaveLength(2),
    );
    expect(importBackgroundImage).toHaveBeenCalledOnce();
    expect(videoImport.importVideoWallpaper).toHaveBeenCalledWith(selected);
    expect(library.addLibraryWallpaper).toHaveBeenLastCalledWith(imported);
    expect(state.update).toHaveBeenLastCalledWith({
      background: "custom",
      customBackground: imported,
    });
    expect(screen.getByText("settings.videoWallpaper")).toBeVisible();
  });
  it("桌面视频通过原生选择器导入，取消时保留图库与当前背景", async () => {
    videoImport.native = true;
    state.settings = { background: "custom", customBackground: image };
    render(<CustomBackgroundPicker />);
    await loaded();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.importVideoBackground",
      }),
    );
    await waitFor(() =>
      expect(videoImport.importVideoWallpaper).toHaveBeenCalledOnce(),
    );
    expect(videoImport.importVideoWallpaper).toHaveBeenCalledWith(undefined);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "settings.importVideoBackground",
        }),
      ).toBeEnabled(),
    );
    expect(library.addLibraryWallpaper).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("同一封面的不同视频分别选择，删除其他视频不会取消当前视频", async () => {
    const first = {
      ...wallpaper,
      video: { id: "c".repeat(64), mime: "video/mp4" as const },
    };
    const second = {
      ...wallpaper,
      id: "b".repeat(64),
      name: "second.mp4",
      video: { id: "d".repeat(64), mime: "video/mp4" as const },
    };
    state.settings = {
      background: "custom",
      customBackground: { ...image, name: second.name, video: second.video },
    };
    library.listWallpaperLibrary.mockResolvedValue([first, second]);
    render(<CustomBackgroundPicker />);
    await loaded();
    expect(
      screen.getByRole("radio", {
        name: "settings.chooseWallpaper: sky.webp",
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", {
        name: "settings.chooseWallpaper: second.mp4",
      }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.deleteWallpaper: sky.webp",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "settings.removeWallpaper",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(
      screen.getByRole("radio", {
        name: "settings.chooseWallpaper: second.mp4",
      }),
    ).toBeChecked();
  });
  it("视频解码失败保留原背景并通过导入详情说明原因", async () => {
    state.settings = { background: "custom", customBackground: image };
    videoImport.importVideoWallpaper.mockRejectedValue(
      new BackgroundVideoError("videoDecode"),
    );
    render(<CustomBackgroundPicker />);
    await loaded();
    choose([new File(["invalid"], "broken.mp4", { type: "video/mp4" })]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const details = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action as
      { onClick(): void } | undefined;
    act(() => details?.onClick());
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "settings.videoDecodeError",
    );
    expect(state.update).not.toHaveBeenCalled();
  });
  it("先持久化图库，再应用成功导入的图片；旧图片传给图库作首次纳入", async () => {
    state.settings.customBackground = image;
    render(<CustomBackgroundPicker />);
    await loaded();
    expect(library.listWallpaperLibrary).toHaveBeenCalledWith(image);
    let finish!: (entry: Wallpaper) => void;
    library.addLibraryWallpaper.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    choose();
    await waitFor(() =>
      expect(library.addLibraryWallpaper).toHaveBeenCalledOnce(),
    );
    expect(state.update).not.toHaveBeenCalled();
    await act(async () => finish(wallpaper));
    expect(state.update).toHaveBeenCalledWith({
      background: "custom",
      customBackground: image,
    });
    expect(
      screen.getByRole("radio", { name: "settings.chooseWallpaper: sky.webp" }),
    ).toBeVisible();
  });
  it("多选导入保留成功项、报告失败文件，并允许继续添加", async () => {
    const second = {
      ...wallpaper,
      id: "b".repeat(64),
      name: "sea.webp",
      dataUrl: image.dataUrl + "AAAA",
    };
    vi.mocked(importBackgroundImage)
      .mockResolvedValueOnce(image)
      .mockRejectedValueOnce(new BackgroundImageError("decode"))
      .mockResolvedValueOnce({ ...second, fit: "cover" });
    library.addLibraryWallpaper
      .mockResolvedValueOnce(wallpaper)
      .mockResolvedValueOnce(second);
    render(<CustomBackgroundPicker />);
    await loaded();
    choose([file(), file("broken.png"), file("sea.png")]);
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      "settings.wallpaperImportFailed",
      expect.objectContaining({
        description: "settings.wallpapersImported",
        action: expect.objectContaining({ label: "common.details" }),
      }),
    );
    const details = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action as
      { onClick(): void } | undefined;
    act(() => details?.onClick());
    expect(screen.getByRole("dialog")).toHaveTextContent("broken.png");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "settings.imageDecodeError",
    );
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(state.update).toHaveBeenLastCalledWith({
      background: "custom",
      customBackground: {
        name: second.name,
        dataUrl: second.dataUrl,
        fit: "cover",
      },
    });
    expect(
      screen.getByRole("button", { name: "settings.importBackground" }),
    ).toBeEnabled();
  });
  it("重复图片只显示一张，切换不会删除图库条目", async () => {
    library.listWallpaperLibrary.mockResolvedValue([wallpaper]);
    render(<CustomBackgroundPicker />);
    await loaded();
    choose();
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio"));
    expect(library.removeLibraryWallpaper).not.toHaveBeenCalled();
  });
  it.each(["switch", "unmount"])(
    "%s 后不会应用晚到的导入结果",
    async (mode) => {
      let finish!: (value: CustomBackground) => void;
      vi.mocked(importBackgroundImage).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const view = render(<CustomBackgroundPicker />);
      await loaded();
      choose();
      if (mode === "switch") {
        state.settings = { background: "dune", customBackground: null };
        view.rerender(<CustomBackgroundPicker />);
      } else view.unmount();
      await act(async () => finish(image));
      expect(state.update).not.toHaveBeenCalled();
      if (mode === "unmount")
        expect(library.addLibraryWallpaper).not.toHaveBeenCalled();
    },
  );
  it("删除须确认，失败保留图片与当前背景，成功后清除选择并恢复可用焦点", async () => {
    state.settings = { background: "custom", customBackground: image };
    library.listWallpaperLibrary.mockResolvedValue([wallpaper]);
    library.removeLibraryWallpaper
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    render(<CustomBackgroundPicker />);
    await loaded();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.deleteWallpaper: sky.webp",
      }),
    );
    expect(library.removeLibraryWallpaper).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "settings.deleteWallpaperDescription: sky.webp",
    );
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(library.removeLibraryWallpaper).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.deleteWallpaper: sky.webp",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "settings.removeWallpaper",
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("settings.libraryError"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { hidden: true })).toBeChecked();
    expect(state.update).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "settings.removeWallpaper",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(state.update).toHaveBeenCalledWith({
      background: "plain",
      customBackground: null,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "settings.importBackground" }),
      ).toHaveFocus(),
    );
  });
  it("删除过程中用户改选另一张图片时保留新选择", async () => {
    state.settings = { background: "custom", customBackground: image };
    library.listWallpaperLibrary.mockResolvedValue([wallpaper]);
    let finish!: () => void;
    library.removeLibraryWallpaper.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<CustomBackgroundPicker />);
    await loaded();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.deleteWallpaper: sky.webp",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "settings.removeWallpaper",
      }),
    );
    state.settings.customBackground = {
      ...image,
      dataUrl: image.dataUrl + "AAAA",
    };
    view.rerender(<CustomBackgroundPicker />);
    await act(async () => finish());
    expect(state.update).not.toHaveBeenCalled();
  });
  it("取消当前图片仅清除设置副本，不删除收藏", async () => {
    state.settings = { background: "custom", customBackground: image };
    library.listWallpaperLibrary.mockResolvedValue([wallpaper]);
    render(<CustomBackgroundPicker />);
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.clearWallpaper" }),
    );
    expect(state.update).toHaveBeenCalledWith({
      background: "plain",
      customBackground: null,
    });
    expect(library.removeLibraryWallpaper).not.toHaveBeenCalled();
  });
  it("重命名持久化后同时更新当前图片名称", async () => {
    state.settings = { background: "custom", customBackground: image };
    library.listWallpaperLibrary.mockResolvedValue([wallpaper]);
    render(<CustomBackgroundPicker />);
    await loaded();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.renameWallpaper: sky.webp",
      }),
    );
    fireEvent.change(screen.getByLabelText("settings.wallpaperName"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(library.renameLibraryWallpaper).toHaveBeenCalledWith(
      wallpaper.id,
      "Renamed",
    );
    expect(state.update).toHaveBeenCalledWith({
      customBackground: { ...image, name: "Renamed" },
    });
  });
  it("加载失败禁用写入，重试成功后恢复管理", async () => {
    library.listWallpaperLibrary
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValueOnce([wallpaper]);
    render(<CustomBackgroundPicker />);
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "settings.importBackground" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await loaded();
    expect(screen.getByRole("radio")).toBeVisible();
  });
  it("清理晚到的跨窗口订阅", async () => {
    let finish!: (stop: () => void) => void;
    library.onWallpaperLibraryChanged.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stop = vi.fn();
    const view = render(<CustomBackgroundPicker />);
    view.unmount();
    await act(async () => finish(stop));
    expect(stop).toHaveBeenCalledOnce();
    expect(library.listWallpaperLibrary).not.toHaveBeenCalled();
  });
  it("StrictMode 的旧图库通知不会使当前加载失效", async () => {
    let stale!: () => void;
    let finish!: (entries: Wallpaper[]) => void;
    library.onWallpaperLibraryChanged.mockImplementationOnce(
      async (handler: () => void) => {
        stale = handler;
        return vi.fn();
      },
    );
    library.listWallpaperLibrary.mockImplementationOnce(
      () =>
        new Promise<Wallpaper[]>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <StrictMode>
        <CustomBackgroundPicker />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(library.listWallpaperLibrary).toHaveBeenCalledOnce(),
    );
    act(() => stale());
    await act(async () => finish([wallpaper]));
    expect(library.listWallpaperLibrary).toHaveBeenCalledOnce();
    expect(screen.getByRole("radio")).toBeVisible();
    await loaded();
  });
});

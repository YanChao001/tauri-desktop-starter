import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as desktop from "@/lib/tauri";
import { importBackgroundImage } from "@/lib/background-image";
import {
  addLibraryWallpaper,
  listWallpaperLibrary,
} from "@/lib/wallpaper-library";
import {
  importVideoWallpaper,
  MAX_WALLPAPER_VIDEO_BYTES,
  resolveWallpaperVideo,
} from "./video-wallpaper";

vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => false),
  chooseWallpaperVideo: vi.fn(),
  wallpaperVideoUrl: vi.fn(),
}));
vi.mock("@/lib/background-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/background-image")>()),
  importBackgroundImage: vi.fn(),
}));
vi.mock("@/lib/wallpaper-library", () => ({
  addLibraryWallpaper: vi.fn(),
  listWallpaperLibrary: vi.fn(),
}));

const reference: desktop.WallpaperVideo = {
  id: "a".repeat(64),
  mime: "video/mp4",
};
const createObjectURL = vi.fn(() => "blob:wallpaper-video");
const revokeObjectURL = vi.fn();
const openDatabase = vi.fn();
let mediaEvent: "error" | "loadeddata";
let duration: number;
let videoWidth: number;
const videos: HTMLVideoElement[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(desktop.isTauri).mockReturnValue(false);
  vi.mocked(desktop.chooseWallpaperVideo).mockResolvedValue({
    video: reference,
    name: "clouds.mp4",
  });
  vi.mocked(desktop.wallpaperVideoUrl).mockResolvedValue(
    "http://wallpaper.localhost/managed-video.mp4",
  );
  mediaEvent = "error";
  duration = 3;
  videoWidth = 1920;
  videos.length = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  vi.stubGlobal("indexedDB", { open: openDatabase });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (
    this: HTMLVideoElement,
  ) {
    if (!this.hasAttribute("src")) return;
    videos.push(this);
    Object.defineProperties(this, {
      duration: { configurable: true, value: duration },
      videoWidth: { configurable: true, value: videoWidth },
      videoHeight: { configurable: true, value: 1080 },
    });
    queueMicrotask(() => this.dispatchEvent(new Event(mediaEvent)));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectReleasedVideo() {
  const video = videos[0];
  expect(video).toBeDefined();
  expect(video?.hasAttribute("src")).toBe(false);
  expect(video?.onloadeddata).toBeNull();
  expect(video?.onerror).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
  expect(addLibraryWallpaper).not.toHaveBeenCalled();
}

describe("动态壁纸导入边界", () => {
  it("不支持的格式和超限视频在创建媒体资源前拒绝", async () => {
    await expect(
      importVideoWallpaper(
        new File(["video"], "clip.avi", { type: "video/avi" }),
      ),
    ).rejects.toMatchObject({ code: "videoType" });
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", {
      value: MAX_WALLPAPER_VIDEO_BYTES + 1,
    });
    await expect(importVideoWallpaper(file)).rejects.toMatchObject({
      code: "videoSize",
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(importBackgroundImage).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it("取消原生文件选择返回空结果，不申请播放地址或保存图库", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.chooseWallpaperVideo).mockResolvedValue(null);
    await expect(importVideoWallpaper()).resolves.toBeNull();
    expect(desktop.wallpaperVideoUrl).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(addLibraryWallpaper).not.toHaveBeenCalled();
  });

  it.each([
    { id: "../clip.mp4", mime: "video/mp4" },
    { id: "a".repeat(64), mime: "video/avi" },
  ])("非法播放引用在访问原生或浏览器存储前拒绝：%s", async (input) => {
    await expect(
      resolveWallpaperVideo(input as desktop.WallpaperVideo),
    ).rejects.toMatchObject({ code: "videoType" });
    expect(desktop.wallpaperVideoUrl).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("原生视频解码失败会卸载媒体源，已有背景与图库不被替换", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    await expect(importVideoWallpaper()).rejects.toMatchObject({
      code: "videoDecode",
    });
    expectReleasedVideo();
    expect(importBackgroundImage).not.toHaveBeenCalled();
    expect(listWallpaperLibrary).not.toHaveBeenCalled();
  });

  it("浏览器视频的尺寸无效时释放临时地址且不写入存储", async () => {
    mediaEvent = "loadeddata";
    videoWidth = 0;
    await expect(
      importVideoWallpaper(
        new File(["video"], "clip.webm", { type: "video/webm" }),
      ),
    ).rejects.toMatchObject({ code: "videoDecode" });
    expectReleasedVideo();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:wallpaper-video",
    );
    expect(importBackgroundImage).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it("已加载的流式WebM在封面优化失败后释放画布和媒体资源", async () => {
    vi.mocked(desktop.isTauri).mockReturnValue(true);
    vi.mocked(desktop.chooseWallpaperVideo).mockResolvedValue({
      video: { ...reference, mime: "video/webm" },
      name: "clouds.webm",
    });
    mediaEvent = "loadeddata";
    duration = Infinity;
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["poster"], { type: "image/jpeg" })),
    );
    vi.mocked(importBackgroundImage).mockRejectedValue(
      new Error("Cannot encode poster"),
    );
    await expect(importVideoWallpaper()).rejects.toMatchObject({
      code: "videoDecode",
    });
    expect(importBackgroundImage).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledOnce();
    const canvas = getContext.mock.contexts[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expectReleasedVideo();
  });
});

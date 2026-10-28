import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { toast } from "sonner";
import type { CustomBackground } from "@/lib/background-image";
import { resolveWallpaperVideo } from "@/lib/video-wallpaper";
import { VideoBackground } from "./video-background";

const motion = vi.hoisted(() => ({ active: true }));
vi.mock("@/hooks/use-demo-motion", () => ({
  useDemoMotion: (_ref: unknown, enabled: boolean) => ({
    active: enabled && motion.active,
  }),
}));
vi.mock("@/hooks/use-latest-translator", () => ({
  useLatestTranslator: () => translate,
}));
function translate(key: string) {
  return key;
}
vi.mock("@/lib/video-wallpaper", () => ({ resolveWallpaperVideo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const background: CustomBackground = {
  name: "clouds.webm",
  dataUrl: "data:image/webp;base64,poster",
  fit: "contain",
  video: { id: "a".repeat(64), mime: "video/webm" },
};
const release = vi.fn();
let play: MockInstance<HTMLMediaElement["play"]>;
let pause: MockInstance<HTMLMediaElement["pause"]>;

beforeEach(() => {
  motion.active = true;
  vi.clearAllMocks();
  play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(resolveWallpaperVideo).mockResolvedValue({
    url: "blob:video",
    release,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("成功开始静音循环播放后才替换封面，非零透明度、名称和填充更新不重新读取视频", async () => {
  const started = pending<void>();
  play.mockReturnValue(started.promise);
  const view = render(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  const video = view.container.querySelector("video")!;
  expect(view.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(video).toHaveStyle({ objectFit: "contain", visibility: "hidden" });
  expect(video.controls).toBe(false);
  await act(async () => started.resolve());
  expect(view.container.querySelector("img")).toBeNull();
  expect(video).toHaveStyle({ visibility: "visible" });
  view.rerender(
    <VideoBackground
      background={{
        ...background,
        name: "renamed",
        fit: "cover",
        video: { ...background.video! },
      }}
      enabled
    />,
  );
  expect(video).toHaveStyle({ objectFit: "cover" });
  expect(resolveWallpaperVideo).toHaveBeenCalledOnce();
  view.rerender(<VideoBackground background={background} enabled={false} />);
  expect(view.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(video).toHaveStyle({ visibility: "hidden" });
  expect(pause).toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(video).not.toHaveAttribute("src");
});

it("减少动效、离屏或文档隐藏时停止播放并恢复封面，停用时不读取视频", async () => {
  motion.active = false;
  const view = render(<VideoBackground background={background} enabled />);
  expect(resolveWallpaperVideo).not.toHaveBeenCalled();
  motion.active = true;
  view.rerender(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(view.container.querySelector("img")).toBeNull());
  motion.active = false;
  view.rerender(<VideoBackground background={background} enabled />);
  expect(view.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(release).toHaveBeenCalledOnce();
  expect(pause).toHaveBeenCalled();
});

it("卸载后释放晚到的视频资源，不尝试播放", async () => {
  const resource = pending<{ url: string; release: () => void }>();
  vi.mocked(resolveWallpaperVideo).mockReturnValue(resource.promise);
  const view = render(<VideoBackground background={background} enabled />);
  view.unmount();
  await act(async () => resource.resolve({ url: "blob:late", release }));
  expect(release).toHaveBeenCalledOnce();
  expect(play).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("晚到的播放回执不能在暂停后重新显示动画，也不能暂停新一轮播放", async () => {
  const first = pending<void>();
  play.mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const view = render(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  view.rerender(<VideoBackground background={background} enabled={false} />);
  await act(async () => first.resolve());
  expect(view.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(view.container.querySelector("video")).toHaveAttribute(
    "data-playing",
    "false",
  );
  const stale = pending<void>();
  play.mockReturnValueOnce(stale.promise).mockResolvedValue(undefined);
  view.rerender(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  view.rerender(<VideoBackground background={background} enabled={false} />);
  view.rerender(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(view.container.querySelector("img")).toBeNull());
  const pausedBefore = pause.mock.calls.length;
  await act(async () => stale.resolve());
  expect(pause).toHaveBeenCalledTimes(pausedBefore);
  expect(view.container.querySelector("video")).toHaveAttribute(
    "data-playing",
    "true",
  );
});

it("文档刚隐藏而动效订阅尚未交付时，晚到播放回执仍保留封面", async () => {
  const started = pending<void>();
  play.mockReturnValue(started.promise);
  const view = render(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => started.resolve());
  expect(view.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(view.container.querySelector("video")).toHaveAttribute(
    "data-playing",
    "false",
  );
  expect(pause).toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("解码或自动播放失败只提示一次，保留封面并释放资源", async () => {
  const view = render(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(view.container.querySelector("img")).toBeNull());
  const video = view.container.querySelector("video")!;
  fireEvent.error(video);
  fireEvent.error(video);
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(
    "settings.videoPlaybackError",
  );
  expect(view.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(video).not.toHaveAttribute("src");
  expect(release).toHaveBeenCalledOnce();
  view.unmount();
  play.mockRejectedValueOnce(new Error("Autoplay blocked"));
  const refused = render(<VideoBackground background={background} enabled />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  expect(refused.container.querySelector("img")).toHaveAttribute(
    "src",
    background.dataUrl,
  );
  expect(resolveWallpaperVideo).toHaveBeenCalledTimes(2);
});

it("StrictMode重建释放旧资源，旧读取失败不影响当前播放", async () => {
  const old = pending<{ url: string; release: () => void }>();
  vi.mocked(resolveWallpaperVideo)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ url: "blob:current", release });
  const view = render(
    <StrictMode>
      <VideoBackground background={background} enabled />
    </StrictMode>,
  );
  await waitFor(() => expect(view.container.querySelector("img")).toBeNull());
  await act(async () => old.reject(new Error("Old lookup failed")));
  expect(toast.error).not.toHaveBeenCalled();
  expect(view.container.querySelector("video")).toHaveAttribute(
    "src",
    "blob:current",
  );
});

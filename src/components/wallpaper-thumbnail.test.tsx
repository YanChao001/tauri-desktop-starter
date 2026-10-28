import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WallpaperThumbnail } from "./wallpaper-thumbnail";

class DecodedImage {
  src = "";
  naturalWidth = 1600;
  naturalHeight = 900;
  finish!: () => void;
  fail!: () => void;

  constructor() {
    images.push(this);
  }

  decode() {
    return new Promise<void>((resolve, reject) => {
      this.finish = resolve;
      this.fail = () => reject(new Error("Invalid image"));
    });
  }
}

const images: DecodedImage[] = [];
function decodedImage(index: number) {
  const image = images[index];
  if (!image) throw new Error(`Missing decoded image: ${index}`);
  return image;
}
let resize: () => void;
let width: number;
const disconnect = vi.fn();
const drawImage = vi.fn();
const context = {
  drawImage,
  imageSmoothingEnabled: false,
  imageSmoothingQuality: "low",
};

beforeEach(() => {
  images.length = 0;
  width = 180;
  vi.clearAllMocks();
  vi.stubGlobal("Image", DecodedImage);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
  vi.spyOn(
    HTMLImageElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => new DOMRect(0, 0, width, 100));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,preview",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("按卡片尺寸和屏幕像素密度平滑生成预览，缩放后重新采样", async () => {
  const { container } = render(<WallpaperThumbnail dataUrl="original" />);
  const image = container.querySelector("img");
  expect(image).toHaveAttribute("src", "original");
  await act(async () => decodedImage(0).finish());
  expect(context.imageSmoothingEnabled).toBe(true);
  expect(context.imageSmoothingQuality).toBe("high");
  expect(drawImage.mock.lastCall?.slice(-2)).toEqual([360, 200]);
  expect(image).toHaveAttribute("src", "data:image/png;base64,preview");
  width = 220;
  act(() => resize());
  expect(drawImage.mock.lastCall?.slice(-2)).toEqual([440, 200]);
});

it("切换图片或卸载后忽略晚到解码，并释放观察器与图片引用", async () => {
  const { container, rerender, unmount } = render(
    <WallpaperThumbnail dataUrl="first" />,
  );
  rerender(<WallpaperThumbnail dataUrl="second" />);
  await act(async () => decodedImage(0).finish());
  expect(container.querySelector("img")).toHaveAttribute("src", "second");
  expect(drawImage).not.toHaveBeenCalled();
  expect(decodedImage(0).src).toBe("");
  unmount();
  await act(async () => decodedImage(1).finish());
  expect(drawImage).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(decodedImage(1).src).toBe("");
});

it("解码失败时保留原图", async () => {
  const { container } = render(<WallpaperThumbnail dataUrl="original" />);
  await act(async () => decodedImage(0).fail());
  expect(container.querySelector("img")).toHaveAttribute("src", "original");
  expect(drawImage).not.toHaveBeenCalled();
});

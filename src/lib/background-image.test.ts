import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backgroundMediaIdentity,
  importBackgroundImage,
  MAX_BACKGROUND_DATA_LENGTH,
  MAX_BACKGROUND_FILE_BYTES,
  normalizeBackgroundImage,
} from "./background-image";

const dataUrl = "data:image/webp;base64," + btoa("RIFF0000WEBP");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pngFile(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], "photo.png", { type: "image/png" });
}

function webpFile(chunk: "VP8X" | "VP8L" | "VP8 ") {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"));
  bytes.set(new TextEncoder().encode("WEBP" + chunk), 8);
  const view = new DataView(bytes.buffer);
  if (chunk === "VP8X") {
    bytes[24] = 31;
    bytes[27] = 15;
  } else if (chunk === "VP8L") {
    bytes[20] = 0x2f;
    view.setUint32(21, 31 | (15 << 14), true);
  } else {
    bytes.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, 32, true);
    view.setUint16(28, 16, true);
  }
  return new File([bytes], "photo.webp", { type: "image/webp" });
}

describe("本机背景图片边界", () => {
  it("视频引用只保留受控身份，同封面视频不会互相替代", () => {
    const first = { id: "a".repeat(64), mime: "video/webm" as const };
    const second = { id: "b".repeat(64), mime: "video/webm" as const };
    const image = { name: "video.webm", dataUrl, fit: "cover" as const };
    expect(normalizeBackgroundImage({ ...image, video: first })).toEqual({
      ...image,
      video: first,
    });
    expect(normalizeBackgroundImage({ ...image, video: null })).toEqual(image);
    expect(backgroundMediaIdentity({ ...image, video: first })).not.toBe(
      backgroundMediaIdentity({ ...image, video: second }),
    );
    expect(
      normalizeBackgroundImage({
        ...image,
        video: { ...first, id: "../video" },
      }),
    ).toBeNull();
    expect(
      normalizeBackgroundImage({
        ...image,
        video: { ...first, mime: "video/quicktime" },
      }),
    ).toBeNull();
  });
  it("保留有效的栅格图片与显示方式，不保留未知字段", () => {
    expect(
      normalizeBackgroundImage({
        name: "山间.webp",
        dataUrl,
        fit: "contain",
        externalUrl: "https://example.com",
      }),
    ).toEqual({ name: "山间.webp", dataUrl, fit: "contain" });
    expect(
      normalizeBackgroundImage({ name: "image.webp", dataUrl }),
    ).toMatchObject({ fit: "cover" });
  });
  it.each([
    "https://example.com/image.jpg",
    "file:///image.jpg",
    "data:image/svg+xml;base64," + btoa("<svg onload='run()'/>"),
    "data:image/webp;base64," + btoa("<svg/>"),
    "data:image/jpeg;base64,not-a-valid-image",
    "data:image/webp;base64," + "A".repeat(MAX_BACKGROUND_DATA_LENGTH),
  ])("拒绝远端地址、脚本格式、错误头部或超限数据", (unsafe) => {
    expect(
      normalizeBackgroundImage({ name: "image", dataUrl: unsafe }),
    ).toBeNull();
  });
  it.each(["", "a".repeat(121), "image\nname.webp"])(
    "拒绝无效文件名",
    (name) => {
      expect(normalizeBackgroundImage({ name, dataUrl })).toBeNull();
    },
  );
  it("在解码前拒绝不支持的格式和过大原图", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(
      importBackgroundImage(
        new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toMatchObject({ code: "type" });
    const large = new File(["x"], "large.png", { type: "image/png" });
    Object.defineProperty(large, "size", {
      value: MAX_BACKGROUND_FILE_BYTES + 1,
    });
    await expect(importBackgroundImage(large)).rejects.toMatchObject({
      code: "size",
    });
    expect(decode).not.toHaveBeenCalled();
  });
  it("损坏图片返回可恢复错误", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("Invalid image")),
    );
    await expect(
      importBackgroundImage(
        new File(["broken"], "broken.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({ code: "decode" });
  });
  it("解码前拦截超大像素，避免先分配完整位图", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(
      importBackgroundImage(pngFile(12_000, 12_000)),
    ).rejects.toMatchObject({
      code: "size",
    });
    expect(decode).not.toHaveBeenCalled();
  });
  it.each([
    new File(
      [
        new Uint8Array([
          0xff, 0xd8, 0xff, 0xe1, 0, 8, 1, 2, 3, 4, 5, 6, 0xff, 0xc2, 0, 8, 8,
          0, 16, 0, 32, 1,
        ]),
      ],
      "photo.jpg",
      { type: "image/jpeg" },
    ),
    webpFile("VP8X"),
    webpFile("VP8L"),
    webpFile("VP8 "),
  ])("支持含元数据的JPEG与WebP各编码的尺寸预检：%s", async (file) => {
    const decode = vi.fn().mockRejectedValue(new Error("Invalid pixels"));
    vi.stubGlobal("createImageBitmap", decode);
    await expect(importBackgroundImage(file)).rejects.toMatchObject({
      code: "decode",
    });
    expect(decode).toHaveBeenCalledOnce();
  });
  it("大照片按解码后的方向自动压缩，复杂图片继续缩小并始终保留高质量平滑", async () => {
    const close = vi.fn();
    const bitmap = { width: 6000, height: 8000, close };
    const decode = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(() => {
        expect(context.imageSmoothingEnabled).toBe(true);
        expect(context.imageSmoothingQuality).toBe("high");
      }),
    };
    const widthSetter = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "width",
    )!.set!;
    vi.spyOn(HTMLCanvasElement.prototype, "width", "set").mockImplementation(
      function (this: HTMLCanvasElement, value) {
        context.imageSmoothingEnabled = false;
        context.imageSmoothingQuality = "low";
        widthSetter.call(this, value);
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback) {
        const encoded =
          this.width <= 500 && this.height <= 500
            ? new Blob(["RIFF0000WEBP"], { type: "image/webp" })
            : new Blob([new Uint8Array(MAX_BACKGROUND_DATA_LENGTH)], {
                type: "image/webp",
              });
        callback(encoded);
      },
    );
    const file = pngFile(8000, 6000);
    Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 });
    const result = await importBackgroundImage(file);
    expect(result.dataUrl).toBe(dataUrl);
    expect(decode).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
    expect(context.drawImage.mock.calls.length).toBeGreaterThan(3);
    expect(context.drawImage.mock.calls[0]).toEqual([bitmap, 0, 0, 1200, 1600]);
    const last = context.drawImage.mock.lastCall as unknown as [
      unknown,
      number,
      number,
      number,
      number,
    ];
    expect(Math.max(last[3], last[4])).toBeLessThan(800);
    expect(close).toHaveBeenCalledOnce();
  });
});

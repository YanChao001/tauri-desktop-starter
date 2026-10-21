import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importBackgroundImage,
  MAX_BACKGROUND_DATA_LENGTH,
  MAX_BACKGROUND_FILE_BYTES,
  normalizeBackgroundImage,
} from "./background-image";

const dataUrl = "data:image/webp;base64," + btoa("RIFF0000WEBP");
afterEach(() => vi.unstubAllGlobals());

describe("本机背景图片边界", () => {
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
});

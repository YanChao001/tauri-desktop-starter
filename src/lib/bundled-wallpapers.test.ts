import { describe, expect, it } from "vitest";
import {
  BUNDLED_WALLPAPERS,
  collectBundledWallpapers,
  getBundledWallpaper,
} from "./bundled-wallpapers";

describe("内置图片壁纸", () => {
  it("按文件名排序收录图片，设置身份不依赖构建产物的哈希地址", () => {
    const wallpapers = collectBundledWallpapers({
      "../../resources/wallpapers/020-山间.webp": "/assets/mountain-hash.webp",
      "../../resources/wallpapers/001-秋日花饰少女.jpg":
        "/assets/autumn-hash.jpg",
    });
    expect(wallpapers).toEqual([
      {
        id: "bundled:001-秋日花饰少女.jpg",
        name: "秋日花饰少女",
        url: "/assets/autumn-hash.jpg",
      },
      {
        id: "bundled:020-山间.webp",
        name: "山间",
        url: "/assets/mountain-hash.webp",
      },
    ]);
    expect(collectBundledWallpapers({})).toEqual([]);
  });

  it("只从构建清单解析内置身份，不接受路径、任意 URL 或不存在的图片", () => {
    const first = BUNDLED_WALLPAPERS[0]!;
    expect(first.name).toBe("秋日花饰少女");
    expect(getBundledWallpaper(first.id)).toBe(first);
    for (const value of [
      "bundled:missing.jpg",
      "bundled:../private.jpg",
      "https://example.com/image.jpg",
      "file:///private.jpg",
      null,
    ]) {
      expect(getBundledWallpaper(value)).toBeUndefined();
    }
  });
});

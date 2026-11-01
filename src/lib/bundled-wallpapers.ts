const DIRECTORY = "../../resources/wallpapers/";

export type BundledWallpaperId = `bundled:${string}`;
export type BundledWallpaper = {
  id: BundledWallpaperId;
  name: string;
  url: string;
};

/** 文件名是稳定身份，构建哈希和部署子路径只属于当前资源地址。 */
export function collectBundledWallpapers(
  assets: Record<string, string>,
): BundledWallpaper[] {
  return Object.entries(assets)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, url]) => {
      const filename = path.slice(DIRECTORY.length);
      const basename = filename
        .slice(filename.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "");
      return {
        id: `bundled:${filename}`,
        name: basename.replace(/^\d+[-_ ]+/, "") || basename,
        url,
      };
    });
}

export const BUNDLED_WALLPAPERS = collectBundledWallpapers(
  import.meta.glob<string>(
    "../../resources/wallpapers/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}",
    { eager: true, query: "?url&no-inline", import: "default" },
  ),
);

/** 存档只能选择随包提供的图片，不能引入任意 URL 或本机路径。 */
export function getBundledWallpaper(
  value: unknown,
): BundledWallpaper | undefined {
  return BUNDLED_WALLPAPERS.find((wallpaper) => wallpaper.id === value);
}

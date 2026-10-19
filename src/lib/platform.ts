/** 运行时平台判断：只用于布局差异，不承载业务逻辑。 */
export type Platform = "macos" | "windows" | "linux" | "web";

export function getPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "web";
}

export function isMacOS() {
  return getPlatform() === "macos";
}

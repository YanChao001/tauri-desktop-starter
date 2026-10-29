// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hexToHsl, hslToHex } from "./color-picker-model";

describe("取色器 HSL 与 HEX", () => {
  it.each([
    [0, 100, 50, "#FF0000"],
    [120, 100, 50, "#00FF00"],
    [240, 100, 50, "#0000FF"],
    [360, 100, 50, "#FF0000"],
    [180, 0, 50, "#808080"],
    [270, 75, 0, "#000000"],
    [270, 75, 100, "#FFFFFF"],
  ] as const)("HSL(%s, %s, %s) 输出 %s", (hue, saturation, lightness, hex) => {
    expect(hslToHex({ hue, saturation, lightness })).toBe(hex);
  });

  it("灰色不虚构新色相，黑白 HEX 的饱和度为零", () => {
    const gray = hexToHsl("#808080", 237);
    expect(gray.hue).toBe(237);
    expect(gray.saturation).toBe(0);
    expect(gray.lightness).toBeCloseTo((128 / 255) * 100);
    expect(hexToHsl("#000000", 237)).toEqual({
      hue: 237,
      saturation: 0,
      lightness: 0,
    });
    expect(hexToHsl("#FFFFFF", 237)).toEqual({
      hue: 237,
      saturation: 0,
      lightness: 100,
    });
  });

  it("转换保留任意原色的 RGB 字节，不在通道调整前丢失精度", () => {
    for (const hex of [
      "#7C3AED",
      "#33AADD",
      "#ABCDEF",
      "#010203",
      "#FEFDFC",
      "#808080",
      "#FF00FF",
      "#00FF00",
    ])
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
  });
});

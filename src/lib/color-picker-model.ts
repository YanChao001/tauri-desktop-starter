export type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

/** 输入为已规范化的六位 HEX；无色相的灰色沿用编辑器当前色相。 */
export function hexToHsl(hex: string, fallbackHue = 0): HslColor {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const difference = high - low;
  const lightness = (high + low) / 2;
  if (difference === 0)
    return { hue: fallbackHue, saturation: 0, lightness: lightness * 100 };
  const sector =
    high === red
      ? (green - blue) / difference
      : high === green
        ? (blue - red) / difference + 2
        : (red - green) / difference + 4;
  return {
    hue: (sector * 60 + 360) % 360,
    saturation: (difference / (1 - Math.abs(2 * lightness - 1))) * 100,
    lightness: lightness * 100,
  };
}

/** 保持 HSL 编辑状态的精度，只在输出 RGB 时量化到字节。 */
export function hslToHex(color: HslColor): string {
  const sector = (((color.hue % 360) + 360) % 360) / 60;
  const saturation = color.saturation / 100;
  const lightness = color.lightness / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const offset = lightness - chroma / 2;
  const channels =
    sector < 1
      ? [chroma, secondary, 0]
      : sector < 2
        ? [secondary, chroma, 0]
        : sector < 3
          ? [0, chroma, secondary]
          : sector < 4
            ? [0, secondary, chroma]
            : sector < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return `#${channels
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

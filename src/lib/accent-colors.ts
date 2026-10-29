export const PRESET_ACCENTS = [
  "neutral",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "emerald",
  "lime",
  "amber",
  "orange",
  "rose",
  "pink",
  "violet",
  "slate",
] as const;
export const ACCENTS = [...PRESET_ACCENTS, "custom"] as const;
export type Accent = (typeof ACCENTS)[number];
export const DEFAULT_CUSTOM_ACCENT = "#7C3AED";

/** 仅允许不透明 RGB 色值进入设置和 CSS。 */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) return null;
  return (
    color.length === 4
      ? `#${[...color.slice(1)].map((channel) => channel.repeat(2)).join("")}`
      : color
  ).toUpperCase();
}

type Rgb = readonly [number, number, number];
function rgb(color: string): Rgb {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}
function luminance(color: Rgb) {
  return color.reduce((total, channel, index) => {
    const srgb = channel / 255;
    const linear =
      srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}
function contrast(first: Rgb, second: Rgb) {
  const light = luminance(first);
  const dark = luminance(second);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}
function hex(color: Rgb) {
  return `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** 沿原色调亮或调暗，兼顾按钮文字和强调色文字的可读性。 */
function readableColor(seed: Rgb, foreground: Rgb, endpoint: number) {
  const target = 4.8;
  if (contrast(seed, foreground) >= target) return hex(seed);
  let lower = 0;
  let upper = 1;
  let result: Rgb = [endpoint, endpoint, endpoint];
  for (let step = 0; step < 16; step++) {
    const fraction = (lower + upper) / 2;
    const candidate: Rgb = [
      Math.round(seed[0] + (endpoint - seed[0]) * fraction),
      Math.round(seed[1] + (endpoint - seed[1]) * fraction),
      Math.round(seed[2] + (endpoint - seed[2]) * fraction),
    ];
    if (contrast(candidate, foreground) >= target) {
      result = candidate;
      upper = fraction;
    } else lower = fraction;
  }
  return hex(result);
}

export function customAccentPalette(value: string) {
  const seed = rgb(normalizeAccentColor(value) ?? DEFAULT_CUSTOM_ACCENT);
  return {
    light: readableColor(seed, [255, 255, 255], 0),
    dark: readableColor(seed, [23, 23, 23], 255),
  };
}

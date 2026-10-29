// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  customAccentPalette,
  DEFAULT_CUSTOM_ACCENT,
  normalizeAccentColor,
  PRESET_ACCENTS,
} from "./accent-colors";

describe("accent colors", () => {
  it("normalizes shorthand and full RGB while rejecting CSS and alpha input", () => {
    expect(normalizeAccentColor("  #a3f ")).toBe("#AA33FF");
    expect(normalizeAccentColor("#7c3aed")).toBe(DEFAULT_CUSTOM_ACCENT);
    for (const value of [
      "red",
      "rgb(0,0,0)",
      "#1234",
      "#12345678",
      "#12",
      "#gggggg",
      "#123456; color:red",
      "var(--primary)",
      "",
      null,
      0,
      {},
    ])
      expect(normalizeAccentColor(value)).toBeNull();
    expect(new Set(ACCENTS).size).toBe(PRESET_ACCENTS.length + 1);
  });

  it("keeps readable seed colors and safely handles invalid stored colors", () => {
    expect(customAccentPalette("#123456").light).toBe("#123456");
    expect(customAccentPalette("#EEEEEE").dark).toBe("#EEEEEE");
    expect(customAccentPalette("var(--background)")).toEqual(
      customAccentPalette(DEFAULT_CUSTOM_ACCENT),
    );
  });

  it("adapts extreme colors for legible light and dark primary labels", () => {
    const luminance = (value: string) => {
      const channels = value.match(/[\da-f]{2}/gi)!.map((part) => {
        const channel = parseInt(part, 16) / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    };
    for (const red of [0, 64, 128, 192, 255]) {
      for (const green of [0, 64, 128, 192, 255]) {
        for (const blue of [0, 64, 128, 192, 255]) {
          const source = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
          const palette = customAccentPalette(source);
          expect(
            1.05 / (luminance(palette.light) + 0.05),
          ).toBeGreaterThanOrEqual(4.8);
          expect(
            (luminance(palette.dark) + 0.05) / (luminance("#171717") + 0.05),
          ).toBeGreaterThanOrEqual(4.8);
        }
      }
    }
  });
});

/** 背景设置与预览共用一份注册表，不依赖界面或语言 provider。 */
export const BACKGROUNDS = [
  "plain",
  "aurora",
  "dune",
  "inkwash",
  "starlight",
  "sakura",
  "moonlit",
  "botanical",
  "cloudscape",
  "custom",
] as const;

export type Background = (typeof BACKGROUNDS)[number];
export type BuiltinBackground = Exclude<Background, "custom">;
export const BUILTIN_BACKGROUNDS = BACKGROUNDS.filter(
  (background): background is BuiltinBackground => background !== "custom",
);

export const BACKGROUND_STYLES = {
  plain: "plain",
  aurora: "cat-linework",
  dune: "coffee-linework",
  inkwash: "mountain-linework",
  starlight: "linework",
  sakura: "cloud-linework",
  moonlit: "moon-linework",
  botanical: "leaf-linework",
  cloudscape: "paper-linework",
} as const satisfies Record<BuiltinBackground, string>;

export const BACKGROUND_INTENSITIES = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
] as const;
export type BackgroundIntensity = (typeof BACKGROUND_INTENSITIES)[number];
export const DEFAULT_BACKGROUND_INTENSITY: BackgroundIntensity = 50;

export function normalizeBackgroundIntensity(
  value: unknown,
): BackgroundIntensity {
  if (typeof value === "number" && Number.isFinite(value)) {
    const index = Math.max(
      0,
      Math.min(BACKGROUND_INTENSITIES.length - 1, Math.round(value / 10)),
    );
    return BACKGROUND_INTENSITIES[index]!;
  }
  if (value === "subtle") return 30;
  if (value === "balanced") return 50;
  if (value === "strong") return 70;
  return DEFAULT_BACKGROUND_INTENSITY;
}

export const BACKGROUND_METADATA = {
  plain: {
    labelKey: "settings.bgPlain",
    descriptionKey: "settings.bgPlainDescription",
  },
  aurora: {
    labelKey: "settings.bgAurora",
    descriptionKey: "settings.bgAuroraDescription",
  },
  dune: {
    labelKey: "settings.bgDune",
    descriptionKey: "settings.bgDuneDescription",
  },
  inkwash: {
    labelKey: "settings.bgInkwash",
    descriptionKey: "settings.bgInkwashDescription",
  },
  custom: {
    labelKey: "settings.bgCustom",
    descriptionKey: "settings.bgCustomDescription",
  },
  starlight: {
    labelKey: "settings.bgStarlight",
    descriptionKey: "settings.bgStarlightDescription",
  },
  sakura: {
    labelKey: "settings.bgSakura",
    descriptionKey: "settings.bgSakuraDescription",
  },
  moonlit: {
    labelKey: "settings.bgMoonlit",
    descriptionKey: "settings.bgMoonlitDescription",
  },
  botanical: {
    labelKey: "settings.bgBotanical",
    descriptionKey: "settings.bgBotanicalDescription",
  },
  cloudscape: {
    labelKey: "settings.bgCloudscape",
    descriptionKey: "settings.bgCloudscapeDescription",
  },
} as const satisfies Record<
  Background,
  { labelKey: string; descriptionKey: string }
>;

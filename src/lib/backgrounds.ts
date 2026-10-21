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
  aurora: "fluid",
  dune: "geometric",
  inkwash: "inkwash",
  starlight: "starmap",
  sakura: "anime",
  moonlit: "pixel",
  botanical: "botanical",
  cloudscape: "papercut",
} as const satisfies Record<BuiltinBackground, string>;

export const BACKGROUND_INTENSITIES = ["subtle", "balanced", "strong"] as const;
export type BackgroundIntensity = (typeof BACKGROUND_INTENSITIES)[number];

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

export const BACKGROUND_INTENSITY_METADATA = {
  subtle: { labelKey: "settings.intensitySubtle" },
  balanced: { labelKey: "settings.intensityBalanced" },
  strong: { labelKey: "settings.intensityStrong" },
} as const satisfies Record<BackgroundIntensity, { labelKey: string }>;

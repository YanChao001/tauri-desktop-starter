import { APP_CONFIG } from "@/config/app";
import {
  normalizeBackgroundImage,
  type CustomBackground,
} from "@/lib/background-image";
import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  getLocale,
  LANGUAGES,
  type Language,
} from "@/i18n/registry";
import {
  BACKGROUNDS,
  BACKGROUND_INTENSITIES,
  type Background,
  type BackgroundIntensity,
} from "@/lib/backgrounds";
export { LANGUAGES, type Language } from "@/i18n/registry";
export {
  BACKGROUNDS,
  BACKGROUND_INTENSITIES,
  type Background,
  type BackgroundIntensity,
} from "@/lib/backgrounds";
export const ACCENTS = [
  "neutral",
  "indigo",
  "blue",
  "emerald",
  "amber",
  "rose",
  "violet",
] as const;
export const RADII = ["sharp", "soft", "round"] as const;
export const FONTS = ["geist", "system", "serif", "mono"] as const;
export const FONT_SIZES = ["sm", "md", "lg"] as const;
export const MOTIONS = ["full", "reduced"] as const;
export const THEMES = ["light", "dark", "system"] as const;
export const APP_MODES = ["demo", "minimal"] as const;
export const WINDOW_POSITIONS = ["remember", "center"] as const;
export const NETWORK_MODES = ["system", "direct"] as const;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 224;
export const SETTINGS_VERSION = 3;
export const STORAGE_KEY = `${APP_CONFIG.browserStorageNamespace}:settings`;
export const THEME_STORAGE_KEY = `${APP_CONFIG.browserStorageNamespace}:theme`;
export type Accent = (typeof ACCENTS)[number];
export type Radius = (typeof RADII)[number];
export type Font = (typeof FONTS)[number];
export type FontSize = (typeof FONT_SIZES)[number];
export type Motion = (typeof MOTIONS)[number];
export type AppTheme = (typeof THEMES)[number];
export type WindowPosition = (typeof WINDOW_POSITIONS)[number];
export type NetworkMode = (typeof NETWORK_MODES)[number];
export type AppSettings = {
  language: Language;
  accent: Accent;
  radius: Radius;
  font: Font;
  fontSize: FontSize;
  background: Background;
  backgroundIntensity: BackgroundIntensity;
  customBackground: CustomBackground | null;
  motion: Motion;
  menuBar: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  appMode: "demo" | "minimal";
  runInBackground: boolean;
  autoCheckUpdates: boolean;
  windowPosition: WindowPosition;
  networkMode: NetworkMode;
  theme: AppTheme;
};
export const DEFAULT_SETTINGS: AppSettings = {
  language: DEFAULT_LANGUAGE,
  accent: "neutral",
  radius: "soft",
  font: "geist",
  fontSize: "md",
  background: "plain",
  backgroundIntensity: "balanced",
  customBackground: null,
  motion: "full",
  menuBar: true,
  sidebarCollapsed: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  appMode: APP_CONFIG.defaultMode,
  runInBackground: false,
  autoCheckUpdates: true,
  windowPosition: "remember",
  networkMode: "system",
  theme: "system",
};
const LEGACY_BACKGROUNDS: Record<string, string> = {
  gradient: "cloudscape",
  grid: "starlight",
  dots: "starlight",
  contour: "starlight",
  orbits: "starlight",
  waves: "cloudscape",
};
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pick<T extends readonly string[]>(
  values: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : fallback;
}
export class SettingsVersionError extends Error {
  readonly code = "FUTURE_SETTINGS_VERSION";
  constructor() {
    super("Settings were created by a newer application version.");
  }
}
function settingsSource(document: Record<string, unknown>) {
  return document.schemaVersion === 1 && isRecord(document.settings)
    ? document.settings
    : document;
}
/** v0 为扁平存档；v1 为包装格式；v2 加入布局与桌面行为；v3 支持本机背景图片。 */
export function migrateSettings(raw: unknown): AppSettings {
  const document = isRecord(raw) ? raw : {};
  if (
    typeof document.schemaVersion === "number" &&
    document.schemaVersion > SETTINGS_VERSION
  )
    throw new SettingsVersionError();
  const source = settingsSource(document);
  const rawBackground =
    typeof source.background === "string"
      ? (LEGACY_BACKGROUNDS[source.background] ?? source.background)
      : source.background;
  const customBackground = normalizeBackgroundImage(source.customBackground);
  const background = pick(
    BACKGROUNDS,
    rawBackground,
    DEFAULT_SETTINGS.background,
  );
  const flag = (
    key:
      "menuBar" | "sidebarCollapsed" | "runInBackground" | "autoCheckUpdates",
  ) =>
    typeof source[key] === "boolean"
      ? (source[key] as boolean)
      : DEFAULT_SETTINGS[key];
  return {
    language: pick(LANGUAGES, source.language, detectLanguage()),
    accent: pick(ACCENTS, source.accent, DEFAULT_SETTINGS.accent),
    radius: pick(RADII, source.radius, DEFAULT_SETTINGS.radius),
    font: pick(FONTS, source.font, DEFAULT_SETTINGS.font),
    fontSize: pick(FONT_SIZES, source.fontSize, DEFAULT_SETTINGS.fontSize),
    background:
      background === "custom" && !customBackground ? "plain" : background,
    customBackground,
    backgroundIntensity: pick(
      BACKGROUND_INTENSITIES,
      source.backgroundIntensity,
      DEFAULT_SETTINGS.backgroundIntensity,
    ),
    motion: pick(MOTIONS, source.motion, DEFAULT_SETTINGS.motion),
    menuBar: flag("menuBar"),
    sidebarCollapsed: flag("sidebarCollapsed"),
    runInBackground: flag("runInBackground"),
    autoCheckUpdates: flag("autoCheckUpdates"),
    windowPosition: pick(
      WINDOW_POSITIONS,
      source.windowPosition,
      DEFAULT_SETTINGS.windowPosition,
    ),
    networkMode: pick(
      NETWORK_MODES,
      source.networkMode,
      DEFAULT_SETTINGS.networkMode,
    ),
    sidebarWidth:
      typeof source.sidebarWidth === "number" &&
      Number.isFinite(source.sidebarWidth)
        ? Math.round(
            Math.max(
              SIDEBAR_MIN_WIDTH,
              Math.min(SIDEBAR_MAX_WIDTH, source.sidebarWidth),
            ),
          )
        : DEFAULT_SETTINGS.sidebarWidth,
    appMode: pick(APP_MODES, source.appMode, DEFAULT_SETTINGS.appMode),
    theme: pick(THEMES, source.theme, DEFAULT_SETTINGS.theme),
  };
}
/** 忽略未知字段，仅规范化调用方明确传入的字段。 */
export function normalizeSettingsPatch(
  current: AppSettings,
  patch: Partial<AppSettings>,
): Partial<AppSettings> {
  if (!isRecord(patch)) return {};
  const keys = Object.keys(DEFAULT_SETTINGS).filter((key) =>
    Object.hasOwn(patch, key),
  ) as Array<keyof AppSettings>;
  const selected = Object.fromEntries(keys.map((key) => [key, patch[key]]));
  const normalized = migrateSettings({ ...current, ...selected });
  if (
    keys.includes("customBackground") &&
    !keys.includes("background") &&
    normalized.background !== current.background
  )
    keys.push("background");
  return Object.fromEntries(keys.map((key) => [key, normalized[key]]));
}
export function settingsDocument(settings: AppSettings) {
  return { schemaVersion: SETTINGS_VERSION, ...settings };
}
export function readInitialSettings(): {
  settings: AppSettings;
  error: string | null;
} {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const document: unknown = raw ? JSON.parse(raw) : {};
    const settings = migrateSettings(document);
    if (isRecord(document) && !Object.hasOwn(settingsSource(document), "theme"))
      settings.theme = pick(
        THEMES,
        window.localStorage.getItem(THEME_STORAGE_KEY) ??
          (APP_CONFIG.browserStorageNamespace === "tauri-starter"
            ? window.localStorage.getItem("theme")
            : null),
        DEFAULT_SETTINGS.theme,
      );
    return { settings, error: null };
  } catch (error) {
    return {
      settings: { ...DEFAULT_SETTINGS, language: detectLanguage() },
      error:
        error instanceof SettingsVersionError
          ? error.code
          : "STORAGE_UNAVAILABLE",
    };
  }
}
export function loadSettings(): AppSettings {
  return readInitialSettings().settings;
}
export function applySettings(
  settings: AppSettings,
  { includeTheme = true }: { includeTheme?: boolean } = {},
) {
  const root = document.documentElement;
  // 首屏在 React 挂载前应用主题；运行时由 next-themes 统一提交，保留过渡旧帧。
  if (includeTheme) {
    const dark =
      settings.theme === "dark" ||
      (settings.theme === "system" &&
        (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false));
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    root.style.colorScheme = dark ? "dark" : "light";
  }
  for (const [name, value] of Object.entries({
    accent: settings.accent,
    radius: settings.radius,
    font: settings.font,
    fontSize: settings.fontSize,
    background: settings.background,
    backgroundIntensity: settings.backgroundIntensity,
    motion: settings.motion,
    language: settings.language,
  }))
    root.dataset[name] = value;
  root.lang = getLocale(settings.language).documentLang;
}

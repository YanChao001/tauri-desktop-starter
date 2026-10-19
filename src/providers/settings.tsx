import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const LANGUAGES = ["zh", "en"] as const;
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
export const BACKGROUNDS = ["plain", "gradient", "grid", "dots"] as const;
export const MOTIONS = ["full", "reduced"] as const;

export type Language = (typeof LANGUAGES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Radius = (typeof RADII)[number];
export type Font = (typeof FONTS)[number];
export type FontSize = (typeof FONT_SIZES)[number];
export type Background = (typeof BACKGROUNDS)[number];
export type Motion = (typeof MOTIONS)[number];

export type AppSettings = {
  language: Language;
  accent: Accent;
  radius: Radius;
  font: Font;
  fontSize: FontSize;
  background: Background;
  motion: Motion;
  menuBar: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "zh",
  accent: "neutral",
  radius: "soft",
  font: "geist",
  fontSize: "md",
  background: "plain",
  motion: "full",
  menuBar: true,
};

const STORAGE_KEY = "tauri-starter:settings";

function pick<T extends readonly string[]>(
  values: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : fallback;
}

/** 读取本地设置，任何异常都回落到默认值——坏掉的 localStorage 不该白屏。 */
export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      language: pick(LANGUAGES, parsed.language, DEFAULT_SETTINGS.language),
      accent: pick(ACCENTS, parsed.accent, DEFAULT_SETTINGS.accent),
      radius: pick(RADII, parsed.radius, DEFAULT_SETTINGS.radius),
      font: pick(FONTS, parsed.font, DEFAULT_SETTINGS.font),
      fontSize: pick(FONT_SIZES, parsed.fontSize, DEFAULT_SETTINGS.fontSize),
      background: pick(
        BACKGROUNDS,
        parsed.background,
        DEFAULT_SETTINGS.background,
      ),
      motion: pick(MOTIONS, parsed.motion, DEFAULT_SETTINGS.motion),
      menuBar:
        typeof parsed.menuBar === "boolean"
          ? parsed.menuBar
          : DEFAULT_SETTINGS.menuBar,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * 把设置写到 <html> 的 data-* 上，具体样式全部由 CSS 接管。
 * 这样切换设置不需要重新渲染整棵树。
 */
export function applySettings(settings: AppSettings) {
  const root = document.documentElement;
  root.dataset.accent = settings.accent;
  root.dataset.radius = settings.radius;
  root.dataset.font = settings.font;
  root.dataset.fontSize = settings.fontSize;
  root.dataset.background = settings.background;
  root.dataset.motion = settings.motion;
  root.lang = settings.language === "zh" ? "zh-CN" : "en";
}

type SettingsContextValue = {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    applySettings(settings);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      // 隐私模式或磁盘满时写不进去，不应该影响界面
      console.warn("保存设置失败", error);
    }
  }, [settings]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const value = useMemo(
    () => ({ settings, update, reset }),
    [settings, update, reset],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings 必须在 SettingsProvider 内使用");
  return context;
}

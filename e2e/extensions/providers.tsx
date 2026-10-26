import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { useThemeSwitch } from "../../src/hooks/use-theme-switch";
export * from "../../src/lib/settings-model";
import { createTranslator } from "../../src/i18n/translate";
import { en } from "../../src/i18n/en";
import { zhCN } from "../../src/i18n/zh-CN";
import {
  DEFAULT_SETTINGS,
  applySettings,
  type AppSettings,
} from "../../src/lib/settings-model";
import type { UnsavedWork } from "../../src/providers/unsaved-work";

const parameters = new URLSearchParams(location.search);
let settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  language: parameters.get("language") === "en" ? "en" : "zh",
  theme: parameters.get("theme") === "dark" ? "dark" : "light",
  motion: parameters.get("motion") === "full" ? "full" : "reduced",
  menuBar: false,
  background: "plain",
};
const listeners = new Set<() => void>();
const settingsKey = "extension-e2e:settings-boundary-mock";
function update(patch: Partial<AppSettings>, broadcast = true) {
  settings = { ...settings, ...patch };
  applySettings(settings);
  document.documentElement.lang = settings.language === "en" ? "en" : "zh-CN";
  if (parameters.has("font"))
    document.documentElement.style.fontSize = parameters.get("font")!;
  for (const listener of listeners) listener();
  if (broadcast)
    localStorage.setItem(
      settingsKey,
      JSON.stringify({ patch, nonce: Math.random() }),
    );
}
window.addEventListener("storage", (event) => {
  if (event.key === settingsKey && event.newValue)
    update(JSON.parse(event.newValue).patch, false);
});
declare global {
  interface Window {
    __extensionSettingsTest: {
      boundaryMock: true;
      update: (patch: Partial<AppSettings>) => void;
      read: () => AppSettings;
    };
  }
}
window.__extensionSettingsTest = {
  boundaryMock: true,
  update,
  read: () => settings,
};
update({}, false);
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function read() {
  return settings;
}
export function useSettings() {
  return { settings: useSyncExternalStore(subscribe, read), update };
}
export function useI18n() {
  const { settings } = useSettings();
  return {
    language: settings.language,
    t: createTranslator(settings.language === "en" ? en : zhCN),
  };
}
export function FixtureTheme({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  return (
    <ThemeProvider
      attribute="class"
      forcedTheme={settings.theme}
      scriptProps={{ type: "text/plain" }}
    >
      {children}
    </ThemeProvider>
  );
}
export function useCommands() {
  const { toggle, setTheme } = useThemeSwitch();
  return {
    commands: [],
    fullscreen: false,
    aboutOpen: false,
    setAboutOpen: () => {},
    execute: async (
      id: string,
      payload?: { point?: { clientX: number; clientY: number } },
    ) => {
      window.__extensionUiTest.commands.push(id);
      if (id === "toggle-theme")
        toggle(payload?.point ?? { clientX: 0, clientY: 0 });
      if (id.startsWith("theme:")) setTheme(id.slice(6));
      if (id === "toggle-sidebar")
        update({ sidebarCollapsed: !settings.sidebarCollapsed });
      return true;
    },
  };
}
export function useRegisterCommands() {}
export function useUnsavedWork(work: UnsavedWork) {
  useEffect(() => {
    window.__extensionUiTest.work = work;
  });
}

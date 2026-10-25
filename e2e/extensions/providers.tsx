import { useEffect } from "react";
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
const language = parameters.get("language") === "en" ? "en" : "zh";
const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  language,
  theme: parameters.get("theme") === "dark" ? "dark" : "light",
  menuBar: false,
  background: "plain",
};
const t = createTranslator(language === "en" ? en : zhCN);
applySettings(settings);
export function useI18n() {
  return { language, t };
}
export function useSettings() {
  return { settings, update: () => {} };
}
export function useCommands() {
  return {
    commands: [],
    fullscreen: false,
    aboutOpen: false,
    setAboutOpen: () => {},
    execute: async (id: string) => {
      window.__extensionUiTest.commands.push(id);
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

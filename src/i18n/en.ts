import type { Messages } from "./zh-CN";
import { enFeatures } from "./en-features";
import { enShowroom } from "./en-showroom";
import { enComponents } from "./en-components";
import { enNavigation } from "./en-navigation";
import { enMotion } from "./en-motion";
import { enSystem } from "./en-system";
import { enData } from "./en-data";
import { enWorkbench } from "./en-workbench";
import { enLabs } from "./en-labs";
import { enCatalog } from "./en-catalog";
import { enRecovery } from "./en-recovery";

/** 与默认语言保持相同词条；缺词或拼错键会在类型检查中报错。 */
export const en = {
  ...enFeatures,
  ...enShowroom,
  ...enComponents,
  ...enNavigation,
  ...enMotion,
  ...enSystem,
  ...enData,
  ...enWorkbench,
  ...enLabs,
  ...enCatalog,
  ...enRecovery,
  "nav.overview": "Showroom",
  "nav.components": "Playground",
  "nav.motion": "Motion lab",
  "nav.bridge": "Native bridge",
  "nav.settings": "Settings",
  "app.native": "Native window",
  "app.preview": "Browser preview",
  "browserDemo.title": "Browser demo",
  "browserDemo.description":
    "Explore the app's interface, themes and motion. Native capabilities require the desktop version.",
  "browserDemo.source": "Source",
  "browserDemo.download": "Download desktop",
  "browserDemo.navigation": "Choose a demo page",
  "title.file": "File",
  "title.edit": "Edit",
  "title.view": "View",
  "title.help": "Help",
  "title.settings": "Settings…",
  "title.reload": "Reload",
  "title.quit": "Quit",
  "title.copyLink": "Copy current URL",
  "title.selectAll": "Select all",
  "title.light": "Light",
  "title.dark": "Dark",
  "title.system": "System",
  "title.toggleMenu": "Show menu bar",
  "title.docs": "Tauri docs",
  "title.repo": "GitHub repository",
  "title.about": "About",
  "title.minimize": "Minimize",
  "title.maximize": "Maximize",
  "title.restore": "Restore",
  "title.close": "Close",
  "title.toggleTheme": "Toggle theme",
  "title.aboutBody":
    "A reusable desktop foundation: Tauri 2 for the native shell, React 19 for the interface. Rename it and start building.",
  "common.copied": "Copied to clipboard",
  "common.openFailed":
    "Unable to open the link. Copy the address into your browser.",
  "common.reset": "Reset preferences",
  "common.resetDone": "Preferences reset",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.renderError": "The interface encountered an error",
  "common.reload": "Reload",
  "common.language": "Language",
  "settings.title": "Settings",
  "settings.subtitle":
    "Preferences stay on this device. Appearance, layout and size apply instantly; startup position applies the next time a window opens.",
  "settings.appearance": "Appearance",
  "settings.appearanceHint": "Theme, accent, radius, font and background",
  "settings.theme": "Theme",
  "settings.accent": "Accent",
  "settings.color.neutral": "Neutral",
  "settings.color.indigo": "Indigo",
  "settings.color.blue": "Blue",
  "settings.color.emerald": "Emerald",
  "settings.color.amber": "Amber",
  "settings.color.rose": "Rose",
  "settings.color.violet": "Violet",
  "settings.accentHint": "Affects buttons, selections and highlights",
  "settings.radius": "Corner radius",
  "settings.radiusSharp": "Sharp",
  "settings.radiusSoft": "Soft",
  "settings.radiusRound": "Round",
  "settings.font": "Font",
  "settings.fontGeist": "Geist (default)",
  "settings.fontSystem": "System",
  "settings.fontSerif": "Serif",
  "settings.fontMono": "Mono",
  "settings.fontSize": "Font size",
  "settings.fontSizeSm": "Small",
  "settings.fontSizeMd": "Medium",
  "settings.fontSizeLg": "Large",
  "settings.background": "Background",
  "settings.bgPlain": "Plain",
  "settings.motion": "Motion",
  "settings.motionHint": "Reduced mode shortens transitions and animations",
  "settings.motionFull": "Full",
  "settings.motionReduced": "Reduced",
  "settings.menuBar": "Show menu bar",
  "settings.menuBarHint": "File / Edit / View / Help in the title bar",
  "settings.runtime": "Runtime",
  "settings.runtimeHint":
    "Comes from Rust and is unavailable in browser preview",
  "settings.appVersion": "App version",
  "settings.tauriVersion": "Tauri version",
  "settings.environment": "Environment",
  "settings.links": "Links",
  "settings.linksHint": "Opens in your default browser",
  "settings.resetHint":
    "Restores appearance, layout, window sizes and background preferences, keeping language, notes and system startup settings",
  "settings.resetConfirmTitle": "Restore default preferences?",
  "settings.resetConfirmDescription":
    "Resets appearance, layout, all window sizes and background preferences. Startup position returns to remembering the last position; open windows stay in place. Language, notes and system startup settings are retained. A preferences file from a newer app version will also be replaced.",
  "settings.windowSize": "Window size",
  "settings.windowSizeHint":
    "Select a common size to apply and remember it immediately, in logical pixels. Maximized windows are restored first. You can also resize by dragging the window edges.",
  "settings.windowBrowserHint":
    "Window dimensions are managed by the desktop app and cannot be changed in browser preview.",
  "settings.windowCompact": "Compact",
  "settings.windowStandard": "Standard",
  "settings.windowComfortable": "Comfortable",
  "settings.windowSpacious": "Spacious",
  "settings.windowDefaultSize": "Application default",
  "settings.windowSizeFitted": "Adapted to this screen",
  "settings.windowPresetUnavailable":
    "Outside the current screen's supported range",
  "settings.windowCurrentSize": "Current size {width} × {height}",
  "settings.windowSizeApplied": "Window size saved",
  "settings.windowPosition": "Startup position",
  "settings.windowPositionRemember": "Remember last position",
  "settings.windowPositionCenter": "Center",
  "settings.windowPositionHint":
    "Takes effect the next time a window opens. Open windows stay in place.",
  "bridge.title": "Frontend ↔ Rust",
  "bridge.subtitle":
    "The frontend calls Rust via invoke. Results are serialized over IPC, and the TypeScript contract is generated from Rust.",
  "bridge.demo": "Call example",
  "bridge.demoHint":
    "Change the name and click. An empty name hits the Rust-side validation to show how errors cross IPC.",
  "bridge.name": "Name",
  "bridge.namePlaceholder": "Enter a name",
  "bridge.call": "Call greet",
  "bridge.result": "Result",
  "bridge.notCalled": "Not called yet",
  "bridge.success": "Rust command succeeded",
  "bridge.failed": "Call failed: {error}",
  "bridge.browserOnly": "Not available in browser preview. Run pnpm app:dev.",
  "bridge.frontend": "Frontend call",
  "bridge.note":
    "Register new commands in bindings.rs, then run pnpm bindings:generate to update the frontend contract.",
  "settings.bgPlainDescription":
    "A clean canvas that keeps the focus on your content",
  "settings.bgStarlight": "Starry notes",
  "settings.bgStarlightDescription":
    "Small stars frame a calm space for reading",
  "settings.bgSakura": "Cherry blossom letter",
  "settings.bgSakuraDescription":
    "Falling blossoms and soft spring colors, like a letter to yourself",
  "settings.bgMoonlit": "Moonlit mountains",
  "settings.bgMoonlitDescription":
    "Moonlight and distant mountains bring a quiet night to your workspace",
  "settings.bgBotanical": "Forest journal",
  "settings.bgBotanicalDescription":
    "Leafy accents and journal details bring a little forest calm",
  "settings.bgCloudscape": "Above the clouds",
  "settings.bgCloudscapeDescription":
    "Open skies and soft clouds leave room for inspiration",
  "settings.backgroundIntensity": "Skin intensity",
  "settings.backgroundIntensityDescription":
    "Adjust how prominent the decorations look while keeping text clear",
  "settings.intensitySubtle": "Subtle",
  "settings.intensityBalanced": "Balanced",
  "settings.intensityStrong": "Strong",
  "settings.skinGallery": "Window skins",
  "settings.skinGalleryDescription":
    "Choose a background for the entire window",
  "settings.activeSkin": "Current skin",
  "settings.skinLightweight": "Lightweight artwork",
  "settings.languageDescription":
    "Switch the interface language instantly and remember your choice",
} satisfies Messages;

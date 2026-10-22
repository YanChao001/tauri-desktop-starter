import { enExperience } from "./en-experience";
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
  ...enExperience,
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
  "settings.bgStarlight": "Star notes",
  "settings.bgAurora": "Cat doodles",
  "settings.bgAuroraDescription":
    "Sleepy cats and little paw prints along the page",
  "settings.bgDune": "Coffee break",
  "settings.bgDuneDescription": "Warm cups, croissants and curls of steam",
  "settings.bgInkwash": "Mountain notes",
  "settings.bgInkwashDescription":
    "A few mountain peaks and tiny cabins in the margins",
  "settings.bgCustom": "My wallpapers",
  "settings.bgCustomDescription": "Make your workspace feel like your own",
  "settings.customImageHint":
    "Add several images, switch, rename or delete. Your collection stays on this device.",
  "settings.importBackground": "Add wallpapers",
  "settings.replaceBackground": "Replace image",
  "settings.removeBackground": "Remove background image",
  "settings.backgroundFit": "Image fit",
  "settings.backgroundCover": "Fill window",
  "settings.backgroundContain": "Show full image",
  "settings.imageFormats":
    "PNG, JPEG or WebP, up to 10MB. Images are automatically optimized.",
  "settings.imageProcessing": "Saving wallpapers…",
  "settings.imageTypeError": "Choose a PNG, JPEG or WebP image.",
  "settings.imageSizeError":
    "The image is too large. Choose one under 10MB and 40 million pixels, or resize it and try again.",
  "settings.imageDecodeError":
    "This image could not be read. Check the file or try another image.",
  "settings.bgStarlightDescription":
    "Linework watermark · a few hand-drawn stars with room to breathe",
  "settings.bgSakura": "Cloud notes",
  "settings.bgSakuraDescription":
    "Fluffy clouds and little suns for a lighter day",
  "settings.bgMoonlit": "Moon orbits",
  "settings.bgMoonlitDescription":
    "Crescent moons and ringed planets in the margins",
  "settings.bgBotanical": "Leaf notes",
  "settings.bgBotanicalDescription":
    "Loose botanical sketches of leaves and little flowers",
  "settings.bgCloudscape": "Paper flights",
  "settings.bgCloudscapeDescription":
    "Paper planes, envelopes and dotted flight paths",
  "settings.backgroundIntensity": "Skin intensity",
  "settings.backgroundIntensityDescription":
    "Adjust how prominent the decorations look while keeping text clear",
  "settings.intensitySubtle": "Subtle",
  "settings.intensityBalanced": "Balanced",
  "settings.intensityStrong": "Strong",
  "settings.skinGallery": "Window skins",
  "settings.skinGalleryDescription":
    "Eight airy line drawings that follow your theme and accent color",
  "settings.activeSkin": "Current skin",
  "settings.skinLightweight": "Hand-drawn textures",
  "settings.languageDescription":
    "Switch the interface language instantly and remember your choice",
  "settings.libraryCount": "{count} / {max} images",
  "settings.libraryEmpty":
    "Add your favorite images to start a wallpaper collection",
  "settings.libraryFull":
    "Your library holds up to 24 wallpapers. Remove an image to make room.",
  "settings.libraryError":
    "Could not save or load wallpapers. Existing images were kept. Please retry.",
  "settings.chooseWallpaper": "Use wallpaper: {name}",
  "settings.deleteWallpaper": "Delete wallpaper: {name}",
  "settings.renameWallpaper": "Rename wallpaper: {name}",
  "settings.renameWallpaperTitle": "Rename wallpaper",
  "settings.renameWallpaperHint":
    "Only the name in your library changes. The original file stays untouched.",
  "settings.wallpaperName": "Wallpaper name",
  "settings.currentWallpaper": "Selected image: {name}",
  "settings.clearWallpaper": "Clear image background",
  "title.fullscreen": "Immersive fullscreen",
  "title.exitFullscreen": "Exit fullscreen",
  "title.fullscreenHint":
    "Press F11 or Esc to exit fullscreen and restore your layout",
} satisfies Messages;

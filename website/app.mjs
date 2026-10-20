const { document } = globalThis;

const english = {
  skip: "Skip to main content",
  navigation: "Main navigation",
  navExperience: "Experience",
  navArchitecture: "Architecture",
  navStart: "Get started",
  navDocs: "Docs",
  techStack: "Technology stack",
  heroEyebrow: "YOUR NEXT DESKTOP APP STARTS HERE",
  heroTitle: "A little foundation.",
  heroAccent: "A lot of possibility.",
  heroDescription:
    "Design, native capabilities, and engineering conventions in one starting point. Build with React, connect to the desktop with Rust, and focus on your product.",
  heroStart: "Start building",
  heroSource: "Explore the source",
  showcaseTitle: "An expressive interface. Clear native boundaries.",
  showcaseLabel: "PROJECT PREVIEW / REAL SCREENSHOTS",
  previewControls: "Choose a project screenshot",
  previewShowroom: "Showroom",
  previewMotion: "Motion lab",
  imageNote:
    "Actual project screenshots. This is a project website; see below for the distinction between browser previews and native desktop features.",
  capabilitiesEyebrow: "FROM INTERFACE TO DESKTOP",
  capabilitiesTitle: "The foundations are here.\nMake the next part yours.",
  capabilitiesIntro:
    "Explore the interaction demos or switch to minimal mode. Keep, replace, and extend what your product needs.",
  featureAppearanceTitle: "Make the interface your own",
  featureAppearance:
    "Light, dark, and system themes; accent colors, typography, corners, and original SVG skins. Chinese and English. A shared command system for menus, shortcuts, and settings search.",
  featureDesktopTitle: "Connect to the desktop",
  featureDesktop:
    "Main and secondary windows, single-instance recovery, window geometry, and a system tray. Background operation and launch at login remain user choices.",
  featureDataTitle: "Give local data a home",
  featureData:
    "Atomic settings, migrations, cross-window sync, and save retries. Rust manages SQLite notes with parameterized queries and version conflict handling.",
  featureBridgeTitle: "A typed route to native features",
  featureBridge:
    "Generate TypeScript IPC bindings from Rust. A shared facade handles native calls; structured errors carry stable codes and retry semantics.",
  featureReleaseTitle: "Connect the delivery workflow",
  featureRelease:
    "Build workflows across three desktop platforms, version checks, installer collection, and SHA-256 manifests. Update downloads and signature verification require maintainer configuration.",
  featureQualityTitle: "Make maintenance observable",
  featureQuality:
    "Frontend, tooling, and Rust tests; real desktop E2E; local error recovery; environment diagnostics; and redacted log previews.",
  architectureEyebrow: "CLEAR BOUNDARIES. ROOM TO GROW.",
  architectureTitle: "Build with the next\nchange in mind.",
  architectureDescription:
    "UI, communication, and system services have distinct responsibilities. Shared entry points express the conventions; types and checks help enforce them so changes remain understandable and verifiable.",
  architectureLink: "Read the architecture and extension principles",
  principleOne: "Load pages on demand; switch between demo and minimal modes",
  principleTwo: "Shared registries for commands, routes, and languages",
  principleThree: "Split by domain complexity as it grows",
  architectureDiagram:
    "Architecture: React pages call a native facade and generated bindings, then the Rust command boundary, native services, and local storage.",
  layerUi: "Pages · shell · commands · settings",
  layerContractTitle: "Generated type contract",
  layerContract: "TypeScript IPC ↔ Rust DTO",
  layerServiceTitle: "Rust native services",
  storageSettings: "Atomic JSON",
  storageSystem: "System APIs",
  diagramNote: "Events synchronize changes. Commands return results.",
  startEyebrow: "FROM SOURCE TO YOUR PRODUCT",
  startTitle: "Choose a starting point. Start building.",
  startIntro:
    "Set up Node.js, pnpm, Rust, and platform prerequisites first. Repository files define tool versions. The first native build compiles dependencies.",
  terminalTitle: "Launch the desktop application",
  copy: "Copy",
  terminalFooter: "React hot reload + a native Rust window",
  startDevelopmentTitle: "Prepare your development environment",
  startDevelopment:
    "Platform prerequisites, environment checks, F5 debugging, and daily commands.",
  startCustomizeTitle: "Give it your application identity",
  startCustomize:
    "Use init:project to sync branding and package identity. Add --minimal if needed, and preview with --dry-run first.",
  startDownloadTitle: "Find published installers",
  startDownload:
    "Visit GitHub Releases and check the target platform, release notes, and signing status.",
  browserBoundary:
    "Just exploring the UI? Run pnpm dev. The browser preview supports themes, languages, and interactions. SQLite, the system tray, native windows, and updates require pnpm app:dev. This project website does not run native operations.",
  resourcesEyebrow: "THE CONTEXT BEHIND THE CODE",
  resourcesTitle: "Give the next change a clear path.",
  resourcesAll: "Browse the documentation",
  resourceArchitectureTitle: "Architecture & data boundaries ↗",
  resourceArchitecture:
    "Entry points, responsibilities, IPC, state, and storage.",
  resourceConventionsTitle: "Engineering & UI conventions ↗",
  resourceConventions: "Code style, component boundaries, and UI guidance.",
  resourceTestingTitle: "Testing & validation ↗",
  resourceTesting: "Frontend, Rust, tooling, and real desktop E2E.",
  resourceReleaseTitle: "Build & release ↗",
  resourceRelease: "Versions, branding, platform packages, and signed updates.",
  resourceSecurityTitle: "Security & permissions ↗",
  resourceSecurity: "Scoped capabilities, local data, and dependency audits.",
  resourceContributingTitle: "Contributing & decisions ↗",
  resourceContributing: "Contribution guidelines, Git collaboration, and ADRs.",
  faqEyebrow: "BEFORE YOU BEGIN",
  faqTitle: "Practical boundaries,\nclearly explained.",
  faqPlatformQuestion: "Which desktop platforms are supported?",
  faqPlatformAnswer:
    "The repository has build and CI workflows for Windows x64, macOS arm64 / x64, and Linux x64. Formats include NSIS / MSI, DMG / APP, and DEB / RPM / AppImage respectively. Available downloads depend on published Releases; validate installation on your own target systems.",
  faqSigningQuestion:
    "Are code signing and automatic updates ready for distribution?",
  faqSigningAnswer:
    "The application maintainer must configure the update public key, release credentials, and platform code signing. The template has an empty update key and makes no update requests by default. OS code signing and update signatures serve different purposes; see the build and release documentation for wiring and limitations.",
  faqScopeQuestion: "Is this a complete business application?",
  faqScopeAnswer:
    "It is a desktop application foundation with UI demonstrations and native examples. Component scenes use in-page demo data; the native SQLite page manages persistent notes. Accounts, cloud sync, business APIs, and sensitive credential storage require product-specific design.",
  faqLicenseQuestion: "Can I build my own product with it?",
  faqLicenseAnswer:
    "The project uses the MIT license. Preserve its required notices and separately review the requirements of your dependencies and distribution channels. Replace the application brand, identifier, signing configuration, and security contact with your own.",
  closingTitle: "Make the next part yours.",
  closingDescription:
    "Start with a clear foundation. Build your own desktop experience.",
  closingAction: "Get started on GitHub",
  footerReleases: "Releases & downloads ↗",
  footerSecurity: "Report a vulnerability ↗",
  backTop: "Back to top ↑",
};

const previews = [
  {
    source: "./assets/showroom-desktop.png",
    zh: {
      caption: "桌面应用 · 深色创意展厅 · 原生 E2E 截图",
      alt: "真实桌面应用的英文深色创意展厅，带自定义标题栏、导航和原创樱花皮肤",
    },
    en: {
      caption: "Desktop app · dark showroom · native E2E screenshot",
      alt: "The actual desktop app's English dark showroom, with custom title bar, navigation, and original cherry blossom skin",
    },
  },
  {
    source: "./assets/motion-desktop.png",
    zh: {
      caption: "桌面应用 · SVG 路径实验 · 原生 E2E 截图",
      alt: "真实桌面应用的动效实验室，展示 SVG 星轨路径、播放暂停与参数控件",
    },
    en: {
      caption: "Desktop app · SVG path experiment · native E2E screenshot",
      alt: "The actual desktop app's motion lab with an SVG orbit experiment, playback controls, and adjustable parameters",
    },
  },
];

const translatedElements = [...document.querySelectorAll("[data-i18n]")];
const ariaElements = [...document.querySelectorAll("[data-i18n-aria]")];
const originalText = new Map(
  translatedElements.map((element) => [
    element,
    [...element.childNodes]
      .map((child) => (child.nodeName === "BR" ? "\n" : child.textContent))
      .join(""),
  ]),
);
const originalAria = new Map(
  ariaElements.map((element) => [element, element.getAttribute("aria-label")]),
);
const languageButton = document.querySelector("#language");
const copyButton = document.querySelector("#copy-command");
const previewControls = document.querySelector("#preview-controls");
const announcement = document.querySelector("#announcement");
const previewImage = document.querySelector("#preview-image");
const previewCaption = document.querySelector("#preview-caption");
const previewCounter = document.querySelector("#preview-counter");
let language = "zh";
let previewIndex = 0;
let copyResetTimer;

function announce(message) {
  announcement.textContent = message;
}

function replaceText(element, value) {
  const lines = value.split("\n");
  element.replaceChildren(
    ...lines.flatMap((line, index) =>
      index === 0
        ? [document.createTextNode(line)]
        : [document.createElement("br"), document.createTextNode(line)],
    ),
  );
}

function updatePreview(index) {
  const preview = previews[index];
  if (!preview) return;
  previewIndex = index;
  if (previewImage.getAttribute("src") !== preview.source) {
    previewImage.src = preview.source;
  }
  previewImage.alt = preview[language].alt;
  previewCaption.textContent = preview[language].caption;
  previewCounter.textContent = `${String(index + 1).padStart(2, "0")} / 02`;
  for (const button of previewControls.querySelectorAll("[data-preview]")) {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.preview) === index),
    );
  }
}

function setLanguage(nextLanguage, persist = false) {
  language = nextLanguage === "en" ? "en" : "zh";
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  for (const element of translatedElements) {
    const value =
      language === "en"
        ? english[element.dataset.i18n]
        : originalText.get(element);
    if (typeof value === "string") replaceText(element, value);
  }
  for (const element of ariaElements) {
    const value =
      language === "en"
        ? english[element.dataset.i18nAria]
        : originalAria.get(element);
    if (typeof value === "string") element.setAttribute("aria-label", value);
  }
  languageButton.querySelector("span").textContent =
    language === "en" ? "简体中文" : "English";
  languageButton.setAttribute(
    "aria-label",
    language === "en" ? "切换为简体中文" : "Switch to English",
  );
  document.title =
    language === "en"
      ? "Tauri Desktop Starter · A foundation for your desktop app"
      : "Tauri Desktop Starter · 让桌面创意落地";
  document.querySelector('meta[name="description"]').content =
    language === "en"
      ? "Build a desktop app with Tauri 2, React 19, and TypeScript. Native storage, windows, themes, tests, and release workflows in one starting point."
      : "Tauri Desktop Starter：以 Tauri 2、React 19 和 TypeScript 构建桌面应用，集成原生存储、多窗口、主题、测试与发布工作流。";
  updatePreview(previewIndex);
  if (persist) {
    try {
      globalThis.localStorage.setItem("starter-website-language", language);
    } catch {
      // Language selection remains usable when browser storage is unavailable.
    }
    announce(
      language === "en"
        ? "Language switched to English."
        : "已切换为简体中文。",
    );
  }
}

languageButton.addEventListener("click", () => {
  globalThis.clearTimeout(copyResetTimer);
  setLanguage(language === "zh" ? "en" : "zh", true);
});

previewControls.addEventListener("click", (event) => {
  const button = event.target.closest("[data-preview]");
  if (!button) return;
  updatePreview(Number(button.dataset.preview));
  announce(previews[previewIndex][language].caption);
});

copyButton.addEventListener("click", async () => {
  globalThis.clearTimeout(copyResetTimer);
  try {
    await globalThis.navigator.clipboard.writeText(
      document.querySelector("#start-command").textContent,
    );
    copyButton.textContent = language === "en" ? "Copied" : "已复制";
    announce(
      language === "en" ? "Startup commands copied." : "启动命令已复制。",
    );
  } catch {
    announce(
      language === "en"
        ? "Copy failed. Select the commands to copy them manually."
        : "复制失败，请选中命令手动复制。",
    );
    copyButton.textContent =
      language === "en" ? "Select to copy" : "请选中复制";
  }
  copyResetTimer = globalThis.setTimeout(() => {
    copyButton.textContent = language === "en" ? english.copy : "复制";
  }, 2500);
});

try {
  const requestedLanguage = new URL(globalThis.location.href).searchParams.get(
    "lang",
  );
  const savedLanguage = globalThis.localStorage.getItem(
    "starter-website-language",
  );
  setLanguage(
    requestedLanguage === "en" || requestedLanguage === "zh"
      ? requestedLanguage
      : savedLanguage,
  );
} catch {
  setLanguage("zh");
}

languageButton.hidden = false;
copyButton.hidden = false;
previewControls.hidden = false;

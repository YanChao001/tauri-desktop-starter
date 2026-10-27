import type { zhCatalog } from "./zh-catalog";
export const enCatalog = {
  "nav.catalog": "Feature guide",
  "catalog.title": "Explore app features",
  "catalog.description":
    "Find a feature, check what it needs and open it to try. Demos, desktop features and features that connect online are clearly marked.",
  "catalog.runtimeBrowser":
    "Browser preview. Open the desktop app to use system features.",
  "catalog.native": "Includes desktop-only features",
  "catalog.local": "Try in the browser",
  "catalog.external": "Connection or extra setup required",
  "catalog.inspect": "Check requirements",
  "catalog.statusHint":
    "Browser experiences include interface interactions and clearly marked demos, without real accounts or system operations. Connecting to external services requires your choice; demo requests are not sent by default.",
  "catalog.search": "Search features or descriptions",
  "catalog.filter": "Requirements",
  "catalog.all": "All features",
  "catalog.open": "Open demo",
  "catalog.source": "Page source",
  "catalog.docs": "Related documentation",
  "catalog.hidden": "Demo entry hidden in minimal mode",
  "catalog.empty": "No matching features.",
  "catalog.modules": "Features & requirements",
  "catalog.overview":
    "Choose a journey, then preview, apply or undo a window style.",
  "catalog.components":
    "Try forms, messages, favorites, a file tree, drag ordering and split panels. Sample content stays on the current page.",
  "catalog.motion":
    "Drag, flip and rearrange interactive cards to explore animation. Pause it or reduce motion at any time.",
  "catalog.bridge":
    "Send a greeting and see the app's response or error message. Requires the desktop app.",
  "catalog.desktop":
    "Adjust windows, the tray and background operation, and keep settings in sync across windows.",
  "catalog.database":
    "Save, search and edit notes on this device, keep unsaved drafts, and back up or restore your notes when needed.",
  "catalog.diagnostics":
    "Check app and storage status, copy a problem report, and inspect backups to recover from startup problems. Original files are preserved.",
  "catalog.recovery":
    "Isolate startup faults, preview backups and recover native data while preserving original files for diagnosis.",
  "catalog.updates":
    "Check for and install updates verified by a digital signature. An available update service is required.",
  "catalog.settings":
    "Adjust language, appearance, layout and window size. Manage startup, background operation, multiple windows and signature-verified updates in the desktop app. Preferences stay in the current browser or desktop app.",
  "catalog.workbench":
    "Choose files or folders on this device to preview, edit and save. Get a warning if another app changes the file.",
  "catalog.tasks":
    "Scan or verify files in a selected folder, follow progress, and stop or retry when needed.",
  "catalog.system":
    "Explicitly try the system clipboard, notifications, global shortcuts and desktop integrations.",
  "catalog.network":
    "Try requests, cached responses and sessions using local demos by default. Connecting online or saving credentials requires your choice.",
  "catalog.dataStudio":
    "Practice filtering 10,000 sample records, adjusting columns, viewing details, importing, exporting and filling out forms. Records are only used for this demo.",
  "catalog.media":
    "Edit or preview documents, pictures and charts. Live connections use a local demo by default; choose the relevant feature to connect online or run background processing.",
  "catalog.catalog":
    "Browse what each feature does and what it needs, then choose a page to try.",
  "catalog.generic": "Open the page to read its description and requirements.",
  "catalog.developerResources": "Developer resources",
  "catalog.moduleResources": "Source and documentation by feature",
  "catalog.tutorial": "Getting started: a new page → Rust call",
  "catalog.rustExample": "Rust command",
  "catalog.typescriptExample": "TypeScript facade and page call",
  "catalog.tutorialHint":
    "These snippets are examples for you to implement, not executable actions. Reuse the existing route, command and error contracts.",
  "catalog.step.page": "Create a page and dictionary entries",
  "catalog.step.pageBody":
    "Add a default-exported page under src/pages/, reuse existing UI components and add Chinese/English strings. First verify input, loading and failure feedback with local state.",
  "catalog.step.route": "Register one route",
  "catalog.step.routeBody":
    "Add the lazy page and APP_ROUTES entry in src/routes.tsx. Navigation, commands and this catalog follow that route source. Document the new page's runtime boundaries.",
  "catalog.step.command": "Validate input at the Rust boundary",
  "catalog.step.commandBody":
    "Add a command in commands.rs, bound input size and format, and return NativeResult. Keep business logic in its service and register it in bindings.rs collect_commands!. Add only permissions that are actually needed.",
  "catalog.step.bindings": "Generate the contract and use the facade",
  "catalog.step.bindingsBody":
    "Generate bindings, add a named capability in src/lib/tauri.ts and call it from the page. Explain browser limits; do not handwrite invoke strings or duplicate DTOs.",
  "catalog.step.verify": "Verify observable behavior",
  "catalog.step.verifyBody":
    "Add targeted input-boundary, success/failure and cancellation regressions. Run relevant types and tests. Native lifecycle changes also need Rust and real desktop verification.",
  "catalog.guide": "Development guide",
  "catalog.architecture": "Architecture & boundaries",
  "catalog.testing": "Validation scope",
} satisfies Record<keyof typeof zhCatalog, string>;

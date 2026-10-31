import type { zhCatalog } from "./zh-catalog";
export const enCatalog = {
  "nav.catalog": "Feature guide",
  "catalog.title": "Explore app features",
  "catalog.description":
    "Browse features and requirements; demos, desktop features, and online connections are labeled.",
  "catalog.runtimeBrowser":
    "Browser preview; use the desktop app for system features.",
  "catalog.native": "Includes desktop-only features",
  "catalog.local": "Try in the browser",
  "catalog.external": "Connection or extra setup required",
  "catalog.inspect": "View requirements",
  "catalog.statusHint":
    "Browser demos do not create real accounts or perform system operations; external connections require explicit action.",
  "catalog.search": "Search features or descriptions",
  "catalog.filter": "Requirements",
  "catalog.all": "All features",
  "catalog.open": "Open",
  "catalog.source": "Page source",
  "catalog.docs": "Related documentation",
  "catalog.hidden": "Demo entry hidden in minimal mode",
  "catalog.empty": "No matching features.",
  "catalog.modules": "Features & requirements",
  "catalog.overview":
    "Choose a journey, then preview, apply or undo a window style.",
  "catalog.components":
    "Explore forms, notifications, favorites, file trees, drag ordering, and split panels; sample content stays on this page.",
  "catalog.motion":
    "Drag, flip, and rearrange cards; pause animation or use reduced motion.",
  "catalog.bridge":
    "Send a greeting and see the app's response or error message. Requires the desktop app.",
  "catalog.desktop":
    "Adjust windows, the tray and background operation, and keep settings in sync across windows.",
  "catalog.database":
    "Save, search, and edit local notes, retain drafts, and back up or restore data.",
  "catalog.diagnostics":
    "Check app and storage status, copy reports, and inspect backups for startup recovery; original files are preserved.",
  "catalog.recovery":
    "Isolate startup faults, preview backups and recover native data while preserving original files for diagnosis.",
  "catalog.updates":
    "Check for and install updates verified by a digital signature. An available update service is required.",
  "catalog.settings":
    "Set language, appearance, layout, and window size. Desktop settings include startup, background operation, windows, and signature-verified updates. Preferences stay in the current browser or app.",
  "catalog.workbench":
    "Choose files or folders on this device to preview, edit and save. Get a warning if another app changes the file.",
  "catalog.tasks":
    "Scan or verify files in a selected folder, follow progress, and stop or retry when needed.",
  "catalog.system":
    "Explicitly try the system clipboard, notifications, global shortcuts and desktop integrations.",
  "catalog.network":
    "Requests, cached responses, and sessions use local demos by default; online access and credential storage require explicit action.",
  "catalog.dataStudio":
    "Filter 10,000 sample records, adjust columns, view details, import/export, and complete forms; records are for this demo.",
  "catalog.media":
    "Edit or preview documents, pictures and charts. Live connections use a local demo by default; choose the relevant feature to connect online or run background processing.",
  "catalog.catalog":
    "Browse feature descriptions and requirements, then open a page.",
  "catalog.generic": "View this feature’s description and requirements.",
  "catalog.developerResources": "Developer resources",
  "catalog.moduleResources": "Source and documentation by feature",
  "catalog.tutorial": "Getting started: a new page → Rust call",
  "catalog.rustExample": "Rust command",
  "catalog.typescriptExample": "TypeScript facade and page call",
  "catalog.tutorialHint":
    "Implementation examples; these snippets do not run here. Reuse existing routes, commands, and error contracts.",
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

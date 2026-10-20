import type { zhCatalog } from "./zh-catalog";
export const enCatalog = {
  "nav.catalog": "Capabilities & start",
  "catalog.title": "From exploration to your desktop app",
  "catalog.description":
    "Explore capabilities, runtime boundaries and source through real routes. Choose a journey, then make one small change across a page, facade and Rust command.",
  "catalog.runtimeBrowser":
    "Browser preview: local interactions work here. Native pages explain how to continue in the desktop app.",
  "catalog.runtimeNative":
    "Desktop app: native actions use your current user environment. External networks, permissions and release configuration may still be unavailable.",
  "catalog.native": "Real native capability",
  "catalog.local": "Local UI / fixture",
  "catalog.external": "External service or configuration",
  "catalog.inspect": "See module details",
  "catalog.statusHint":
    "Local includes browser UI and explicitly labelled fixtures; it does not imply real accounts or system operations. External demo requests require an explicit choice.",
  "catalog.search": "Search capabilities, pages or descriptions",
  "catalog.filter": "Capability type",
  "catalog.all": "All capabilities",
  "catalog.open": "Open demo",
  "catalog.source": "Page source",
  "catalog.docs": "Related documentation",
  "catalog.hidden": "Demo entry hidden in minimal mode",
  "catalog.empty": "No matching capabilities.",
  "catalog.journey": "Choose an exploration journey",
  "catalog.journeyHint":
    "Journeys reuse the app's navigation groups. Each entry opens a real page in this app.",
  "catalog.modules": "Modules & capability boundaries",
  "catalog.overview":
    "Preview, apply and undo a window style; explore controlled motion.",
  "catalog.components":
    "Try forms, feedback, filtering and favorites. Scenario data belongs to the current page.",
  "catalog.motion":
    "Tune springs, layouts, paths and tilt, with reduced-motion and pause support.",
  "catalog.bridge":
    "Invoke real Rust commands and inspect successful results and structured errors.",
  "catalog.desktop":
    "Try windows, tray, background operation and cross-window settings sync.",
  "catalog.database":
    "Native note queries, revision conflicts, drafts, bulk operations and backup recovery.",
  "catalog.diagnostics":
    "Read runtime state and redacted logs. Review the data scope before exporting.",
  "catalog.recovery":
    "Isolate startup faults, preview backups and recover native data while preserving original files for diagnosis.",
  "catalog.updates":
    "Signed update flow. Maintainers must configure a public key, endpoint and usable release assets.",
  "catalog.settings":
    "Browser-local preferences and native desktop snapshots, with immediate language, theme and layout feedback.",
  "catalog.workbench":
    "Use native pickers for bounded files and directories, edit content and handle save conflicts.",
  "catalog.tasks":
    "Run controlled background tasks and observe progress, cancellation, failure and retry.",
  "catalog.system":
    "Explicitly try the system clipboard, notifications, global shortcuts and desktop integrations.",
  "catalog.network":
    "Local request-failure scenarios, cache and sessions, with optional HTTPS and system credential storage.",
  "catalog.dataStudio":
    "Virtualize 10,000 local records, inspect partial bulk failures and complete a complex form.",
  "catalog.media":
    "Safe Markdown, local media and charts, with optional WSS and a controlled worker.",
  "catalog.catalog":
    "Discover capabilities from current routes, inspect source and follow the page-to-IPC exercise.",
  "catalog.generic":
    "Inspect the page and architecture documentation for its runtime boundaries.",
  "catalog.tutorial": "Getting started: a new page → Rust call",
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

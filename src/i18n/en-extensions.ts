export const enExtensions = {
  "ext.market.discover": "Discover plugins",
  "ext.market.title": "Official plugin market",
  "ext.market.hint":
    "Browse plugins reviewed by the market maintainer. Review details and permissions after downloading. Installation keeps plugins disabled until you explicitly authorize them.",
  "ext.market.repository": "Market repository and source",
  "ext.market.refresh": "Refresh market",
  "ext.market.loading": "Loading the signed market catalog…",
  "ext.market.stale":
    "The market could not be refreshed. Showing the last verified catalog; availability will be checked again before downloading.",
  "ext.market.search": "Search plugins",
  "ext.market.searchHint": "Name, description, author or ID",
  "ext.market.category": "Category",
  "ext.market.category.all": "All categories",
  "ext.market.category.text": "Text",
  "ext.market.category.data": "Data",
  "ext.market.category.tools": "Utilities",
  "ext.market.category.games": "Games",
  "ext.market.featured": "Featured",
  "ext.market.currentVersion": "Installed version: {version}",
  "ext.market.installHint": "Review before installing",
  "ext.market.download": "Download and review",
  "ext.market.downloading": "Downloading and verifying…",
  "ext.market.update": "Download update",
  "ext.market.updateTo": "Update to {version}",
  "ext.market.installed": "This version is installed",
  "ext.market.newerInstalled": "Newer version installed",
  "ext.market.noMatches": "No plugins match your search.",
  "ext.market.empty": "No plugins are currently listed.",
  "ext.market.revision": "Verified market catalog · revision {revision}",
  "ext.market.notConfigured":
    "This app has no official market configured. Import a local extension package instead.",
  "ext.market.unavailable":
    "The plugin market is unavailable. Check your connection and refresh. Installed extensions remain available.",
  "ext.market.invalid":
    "Market catalog or package verification failed. No extensions were installed or changed.",
  "ext.market.changed":
    "This market version changed or was removed. Refresh the catalog and choose again.",
  "ext.installed": "Installed extensions",
  "ext.open": "Open",
  "ext.openNamed": "Open {name}",
  "ext.details": "Package details and permissions",
  "ext.appSessionHint":
    "Navigation in this window preserves progress; restarting does not. Export JSON for your records; importing is not supported. Ending the session clears inputs, progress and results.",
  "ext.noPermissions": "Does not request host text, file or network data.",
  "ext.appLoad": "Load app",
  "ext.appWorking": "Working…",
  "ext.appStatus": "Execution status",
  "ext.appExport": "Export session",
  "ext.appClose": "End session",
  "ext.appExportHint":
    "Save current inputs, state and results as JSON for your records. Importing to restore a session is not supported.",
  "ext.appStopHint":
    "Request cancellation and wait for the current operation to stop. Inputs and the previous result are retained.",
  "ext.appCloseHint":
    "Clear this session and exit without disabling or uninstalling the extension.",
  "ext.fieldLimit": "Each field accepts up to {bytes} UTF-8 bytes.",
  "nav.extensions": "Extensions",
  "catalog.extensions":
    "Install Extism Wasm plugins with explicit text, file and network data access. Develop in Rust, JavaScript or TypeScript.",
  "ext.title": "Extensions",
  "ext.description":
    "Open plugins like apps or launch tools from the command palette, with cross-language Extism Wasm and interactive app views.",
  "ext.boundary":
    "Plugins run in Wasm and receive only explicitly submitted data. System commands, arbitrary directories and direct networking are unavailable; the host delivers selected file and HTTPS data after authorization.",
  "ext.installFile": "Choose extension package",
  "ext.packageHint":
    "Choose a .starter-extension.json package, up to 24 MiB. Preview and installation do not execute it. New installations are disabled.",
  "ext.docs": "Extension development and packaging",
  "ext.host": "Runtime",
  "ext.empty":
    "No extensions installed. Restore the bundled lab or import a package built with an Extism PDK.",
  "ext.review": "Review extension package",
  "ext.author": "Declared author (not signature verified)",
  "ext.version": "Version",
  "ext.permissions": "Declared capabilities and host data access",
  "ext.hash": "Wasm module SHA-256",
  "ext.hashHint":
    "The content hash identifies the file and detects changes. It does not authenticate the author or establish trust.",
  "ext.bytes": "Wasm module: {bytes} bytes",
  "ext.install": "Install and keep disabled",
  "ext.upgrade": "Confirm upgrade and reset consent",
  "ext.upgradeHint":
    "Installed version: {version}. Only a higher numeric version is accepted. Upgrades clear grants, disable the extension, and request that the previous run stop.",
  "ext.enable": "Enable",
  "ext.disable": "Disable",
  "ext.enabled": "Enabled",
  "ext.disabled": "Disabled",
  "ext.enableTitle": "Confirm trust and capabilities",
  "ext.trust":
    "I consent to sharing authorized data with this plugin and understand that its author has not been authenticated by a signature.",
  "ext.grantHint":
    "Confirm each declared capability to enable. Files and HTTPS data must still be explicitly selected for each run. Cancel to decline any capability.",
  "ext.permission.files:read":
    "Files: receive selected, authorized text file contents",
  "ext.permission.network:https":
    "HTTPS: receive bounded responses from declared public hosts",
  "ext.allowedHosts": "Host HTTPS broker sites",
  "ext.uninstall": "Uninstall",
  "ext.uninstallTitle": "Uninstall this extension?",
  "ext.uninstallHint":
    "Stop the extension and remove application-managed records and Wasm cache. Original packages and user files are retained.",
  "ext.cancel": "Cancel",
  "ext.refresh": "Refresh extensions",
  "ext.running": "Running: {id}",
  "ext.runner": "Run a tool",
  "ext.choose": "Select an extension command",
  "ext.noEnabled": "Install and enable an extension first.",
  "ext.input": "Input text",
  "ext.inputHint":
    "Up to 64 KiB UTF-8, passed as data to the selected Wasm export.",
  "ext.files": "Choose text files for this run",
  "ext.filesHint":
    "Up to 3 authorized text files, totaling 64 KiB. The saved disk version is sent, with names and content only.",
  "ext.clearFiles": "Clear file selection",
  "ext.url": "HTTPS URL for this run (optional)",
  "ext.urlHint":
    "Only HTTPS GET to the listed hosts; no host credentials or redirects. Limited to 3 seconds and 64 KiB.",
  "ext.run": "Run extension",
  "ext.runHint":
    "One command runs at a time. Wasm execution is limited to 5 seconds, memory and compute budgets; initial compilation can take longer. Every run uses a fresh instance.",
  "ext.stop": "Request stop",
  "ext.stopping": "Waiting for the extension to stop…",
  "ext.output": "Result",
  "ext.noOutput": "No result yet",
  "ext.export": "Export inputs and result",
  "ext.sessionHint":
    "Inputs and results remain on this page and can be exported as JSON. Leaving stops execution; unexported content is registered as unsaved work.",
  "ext.error.incompatible":
    "The package, API or registry version is incompatible. Original data was retained.",
  "ext.error.failed":
    "Plugin execution, resource budget, HTTPS request or output validation failed. Inputs and the previous result were retained.",
  "ext.error.timeout":
    "The extension exceeded its execution limit. Waiting for execution to stop.",
  "ext.error.busy":
    "Another extension has not finished. Wait for it to stop, then retry.",
  "ext.error.unavailable":
    "Extensions are unavailable during startup recovery, update installation or shutdown.",
  "ext.packageError":
    "Cannot read the extension package. Check UTF-8 encoding and the 24 MiB limit.",
  "experience.extensions": "Install and run extensions",
  "experience.extensionsHint":
    "Review → authorize → execute a Wasm command → stop and uninstall.",
  "experience.extensions.1": "Inspect the bundled lab",
  "experience.extensions.1Hint":
    "Inspect the installed lab’s commands, permissions and hash, or import a third-party Wasm package. Installation does not execute the plugin.",
  "experience.extensions.2": "Confirm trust and enable",
  "experience.extensions.2Hint":
    "Installation starts disabled. Confirm data sharing and declared access to enable; commands then appear in the command palette.",
  "experience.extensions.3": "Run and inspect the result",
  "experience.extensions.3Hint":
    "Open the lab from the sidebar to explore text analysis, real data and Lights out. Open a native window, export the session or request stop.",
  "experience.extensions.4": "Disable or uninstall",
  "experience.extensions.4Hint":
    "Disabling revokes host data access and stops execution. Uninstalling removes only managed records and Wasm modules.",
  "experience.preview.extensions.1":
    "Review a local Wasm package and its exported commands",
  "experience.preview.extensions.2":
    "Authorize and enable, then explicitly select inputs",
  "experience.preview.extensions.3":
    "Run, stop, disable and uninstall Extism plugins",
  "ext.inputFormat": "Input format",
  "ext.resultFormat": "Result format",
  "ext.commands": "Extension commands",
  "ext.permission.text:read":
    "Text: receive the text explicitly submitted for this run",
  "ext.bundledHint":
    "Extension Lab comes installed. Enable it to open from the sidebar or in a native window. Uninstalling it is permanent until you install it again.",
  "ext.hostData": "Host data · explicit transfer",
  "ext.hostDataHint":
    "Only Send selected data transfers these contents. Regular actions send the app’s own state and fields; they do not read files or repeat network requests.",
  "ext.sendData": "Send selected data",
  "ext.openWindow": "Open in separate window",
  "ext.windowHint":
    "Use the system title bar to minimize, maximize or close. The main window stays usable. This window has its own session.",
  "ext.entryUnavailable":
    "This extension is disabled, uninstalled, or this app command no longer exists. Check its status in the extension center.",
  "ext.restoreLab": "Restore bundled lab",
} as const;

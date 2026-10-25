export const enExtensions = {
  "ext.recovery.title": "Extension archive recovery",
  "ext.checkBundledUpdate": "Check bundled lab for updates",
  "ext.bundledCurrent": "The bundled lab is already up to date.",
  "ext.bundledNewerInstalled":
    "The installed lab is newer than the bundled version. The installed package was retained.",
  "ext.bundledDifferent":
    "The installed lab has the same version but different contents. The installed package was retained; a replacement needs a higher package version.",
  "ext.recovery.checking": "Checking the extension archive…",
  "ext.recovery.checkHint":
    "Check whether these are recognized development archives before rebuilding extensions. The check does not change data.",
  "ext.recovery.checkAgain": "Check archive again",
  "ext.recovery.legacy":
    "Found {count} extension installation records from an older version. Archive them before setting up the current bundled extension.",
  "ext.recovery.current":
    "The archive already uses a supported version. Refresh the extension list and review the affected package. No archive operation is available.",
  "ext.recovery.future":
    "This archive was created by a newer version. Use an app version that supports it. The original archive is preserved.",
  "ext.recovery.invalid":
    "This archive could not be recognized safely. Keep the original directory for diagnosis and recovery. Automatic archiving is unavailable.",
  "ext.recovery.unavailable":
    "Extension archives cannot be changed during startup recovery, updates, or shutdown. Finish that operation and check again.",
  "ext.recovery.archive": "Archive old extensions and rebuild",
  "ext.recovery.confirmTitle": "Archive old extension installations?",
  "ext.recovery.confirmHint":
    "Move the complete old extension directory to an archive and reload the current bundled extension, disabled by default. App settings, notes, and plugin private data are retained. Old extension sessions require their original package version. The archive location will be shown after completion.",
  "ext.recovery.confirm": "Confirm archive and rebuild",
  "ext.recovery.archiving": "Archiving…",
  "ext.recovery.archived": "The old extension directory was archived.",
  "ext.recovery.archiveLocation": "Archive location:",
  "ext.recovery.afterArchive":
    "Extension loading is checked separately. If an error remains, keep this archive and retry refreshing the list. New bundled extensions remain disabled until you review and authorize them.",
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
  "ext.market.incompatible":
    "The signed market catalog uses a protocol this app does not support. The market maintainer needs to publish a compatible catalog, or you need an app version that supports it. Installed extensions and local package imports remain available.",
  "ext.market.expired":
    "The signed market catalog has expired. The market maintainer needs to sign and publish a renewed catalog with a higher revision; then refresh the market. Installed extensions and local package imports remain available.",
  "ext.market.invalid":
    "Market catalog or package verification failed. No extensions were installed or changed.",
  "ext.market.changed":
    "This market version changed or was removed. Refresh the catalog and choose again.",
  "ext.installed": "Installed extensions",
  "ext.open": "Open",
  "ext.openNamed": "Open {name}",
  "ext.details": "Package details and permissions",
  "ext.appSessionHint":
    "Navigation in this window preserves progress. Export a session to restore it later with the same package version. Plugin private storage survives restarts; ending a session clears only its inputs, progress and results.",
  "ext.noPermissions":
    "No required capabilities. Optional capabilities may be enabled separately.",
  "ext.appLoad": "Load app",
  "ext.appWorking": "Working…",
  "ext.appStatus": "Execution status",
  "ext.appExport": "Export session",
  "ext.appClose": "End session",
  "ext.sessionTools": "Session tools",
  "ext.appCloseTitle": "End this session?",
  "ext.appCloseDescription":
    "Current inputs, progress and results have not been exported. Ending this session clears them. Saved plugin private data is retained. Export the session first or discard this progress.",
  "ext.appDiscardClose": "Discard and end",
  "ext.appSaveClose": "Export session and end",
  "ext.appExportHint":
    "Save current inputs, state and results as JSON. Import into the same command and exact package version to restore. Files must be selected again; credentials are never exported.",
  "ext.appStopHint":
    "Request cancellation and wait for the current operation to stop. Inputs and the previous result are retained.",
  "ext.appCloseHint":
    "Clear this session and exit without disabling or uninstalling the extension.",
  "ext.fieldLimit": "Each field accepts up to {bytes} UTF-8 bytes.",
  "nav.extensions": "Extensions",
  "catalog.extensions":
    "Install Extism Wasm plugins with explicit text, file and network data access. Develop in Rust, JavaScript or TypeScript.",
  "ext.title": "Extensions",
  "ext.description": "Find and manage plugins, then open your tools and apps.",
  "ext.dataBoundary": "Permissions and data",
  "ext.boundary":
    "Plugins run in Wasm. You control required and optional capabilities; file access uses selected resources, networking is restricted to declared origins and methods, and private storage is isolated per plugin.",
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
  "ext.upgrade": "Confirm upgrade",
  "ext.upgradeHint":
    "Installed version: {version}. Only a higher numeric version is accepted. Updates recheck trust and capabilities: compatible patches from the same trusted source can retain consent; other updates disable the extension for review.",
  "ext.enable": "Enable",
  "ext.disable": "Disable",
  "ext.enabled": "Enabled",
  "ext.disabled": "Disabled",
  "ext.enableTitle": "Confirm trust and capabilities",
  "ext.trust":
    "I consent to sharing authorized data with this plugin and understand that its author has not been authenticated by a signature.",
  "ext.grantHint":
    "Approve required capabilities and choose any optional capabilities. Offline commands remain available when optional network access is declined. You can change grants later.",
  "ext.permission.files:read":
    "Files: receive selected, authorized text file contents",
  "ext.permission.network:https":
    "HTTPS: call declared public origins and HTTP methods",
  "ext.allowedHosts": "Declared network origins and methods",
  "ext.uninstall": "Uninstall",
  "ext.uninstallTitle": "Uninstall this extension?",
  "ext.uninstallHint":
    "Stop the extension, revoke its stored service credentials, and remove installation records and Wasm cache. User files and private storage remain. Clear private storage before uninstalling if you no longer need it.",
  "ext.cancel": "Cancel",
  "ext.refresh": "Refresh extensions",
  "ext.running": "Running: {id}",
  "ext.runner": "Run a tool",
  "ext.choose": "Select an extension command",
  "ext.noEnabled": "Install and enable an extension first.",
  "ext.input": "Input text",
  "ext.inputHint":
    "Up to 1 MiB UTF-8, passed as data to the selected Wasm export.",
  "ext.files": "Choose files for this run",
  "ext.filesHint":
    "Up to 16 user-selected files, totaling 2 MiB. Only file names, media types and saved contents are shared; binary data uses base64.",
  "ext.clearFiles": "Clear file selection",
  "ext.url": "URL for this run (optional)",
  "ext.urlHint":
    "Sending a URL asks the host for one GET to a declared origin. Plugins can make further authorized HTTP requests through the host broker; credentials are scoped to configured origins and aliases.",
  "ext.run": "Run extension",
  "ext.runHint":
    "Commands enter a bounded queue with up to two active runs. Wasm execution has memory, compute and time budgets; compilation can take longer. Each operation uses a fresh instance.",
  "ext.stop": "Request stop",
  "ext.stopping": "Waiting for the extension to stop…",
  "ext.output": "Result",
  "ext.noOutput": "No result yet",
  "ext.export": "Export inputs and result",
  "ext.sessionHint":
    "Export and import sessions for the same exact package version. File names are retained for reference; selecting files again is required. Credentials are never included.",
  "ext.error.incompatible":
    "The package, API or registry version is incompatible. Original data was retained.",
  "ext.error.failed":
    "Plugin execution, resource budget, HTTPS request or output validation failed. Inputs and the previous result were retained.",
  "ext.error.timeout":
    "The extension exceeded its execution limit. Waiting for execution to stop.",
  "ext.error.busy":
    "The extension queue is full or this session still has an active operation. Wait for it to finish and retry.",
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
    "Send selected data transfers these contents. Plugins may use separately authorized networking or private storage during ordinary actions.",
  "ext.sendData": "Send selected data",
  "ext.openWindow": "Open in separate window",
  "ext.windowHint":
    "Use the system title bar to minimize, maximize or close. The main window stays usable. This window has its own session.",
  "ext.entryUnavailable":
    "This extension is disabled, uninstalled, or this app command no longer exists. Check its status in the extension center.",
  "ext.restoreLab": "Restore bundled lab",
  "ext.minHostVersion": "Minimum host version",
  "ext.requiredPermissions": "Required capabilities",
  "ext.optionalPermissions": "Optional capabilities",
  "ext.managePermissions": "Manage permissions",
  "ext.savePermissions": "Save permissions",
  "ext.limitedCommands":
    "{available} of {total} commands available with current grants.",
  "ext.permission.network:local":
    "Local network: call explicitly declared loopback or private network services",
  "ext.permission.storage":
    "Private storage: persist plugin data across restarts",
  "ext.queueSummary": "{count} queued or running operations",
  "ext.queued": "Queued, waiting for a runtime slot…",
  "ext.storage": "Plugin private storage",
  "ext.storageHint":
    "Data is isolated for this plugin and retained on uninstall. Clear it explicitly when no longer needed.",
  "ext.storageUsage": "{entries} entries · {bytes} bytes",
  "ext.clearStorage": "Clear private storage",
  "ext.clearStorageHint":
    "Permanently remove this plugin’s private data. Current sessions and selected files are retained. Stop active operations first to avoid conflicts.",
  "ext.credentials": "Service credentials",
  "ext.credentialsHint":
    "Enter the alias expected by the plugin. The host adds the secret as a Bearer token only to the exact selected origin. Plugins and session exports cannot read it. Saving the same alias replaces its secret.",
  "ext.credentialOrigin": "Service origin",
  "ext.credentialAlias": "Credential alias",
  "ext.credentialSecret": "Secret / access token",
  "ext.saveCredential": "Save credential",
  "ext.deleteCredential": "Delete credential",
  "ext.deleteCredentialNamed": "Delete credential {alias}",
  "ext.rollback": "Restore version {version}",
  "ext.rollbackTitle": "Restore the previous package?",
  "ext.rollbackHint":
    "Replace the installed package with its previous version and disable it. Permissions must be reviewed again. Private storage is retained and may use a newer schema.",
  "ext.rollbackConfirm": "Restore previous version",
  "ext.importSession": "Import session JSON",
  "ext.importSessionHint":
    "Replace this command’s inputs, progress and result with the selected session. Nothing runs until you choose an action. Private storage is unaffected.",
  "ext.replaceSession": "Replace current session",
  "ext.importFileHint": "Reselect these files before sending data:",
  "ext.sessionInvalid":
    "The session file is invalid, exceeds 8 MiB, or belongs to a different command or package version.",
  "ext.artifacts": "Generated files",
  "ext.saveArtifact": "Save {name}",
  "ext.saveResult": "Save result separately",
  "ext.switchCommand": "Switch command",
  "ext.switchCommandHint":
    "Discard the current command’s unexported inputs and result? Export the session first to keep them.",
  "ext.source": "Package source",
  "ext.source.market": "Verified market package (catalog signature)",
  "ext.source.bundled": "Bundled with the host app",
  "ext.source.local": "Local package (source not authenticated)",
  "ext.source.key": "Market signing key fingerprint:",
} as const;

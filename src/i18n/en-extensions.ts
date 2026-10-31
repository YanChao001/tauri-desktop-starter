export const enExtensions = {
  "ext.error.networkBlocked":
    "The destination is a protected address. Check network settings and proxy permission.",
  "ext.error.imageRedirect":
    "The source returned a redirect. Retry or switch image sources.",
  "ext.error.imageSourceRejected":
    "Image request rejected. Retry later or switch sources.",
  "ext.error.imageInvalid": "Unsupported or damaged image. Choose another.",
  "ext.error.imageTooLarge":
    "Image exceeds size or decoding limits. Choose another.",
  "ext.error.attachmentTooLarge":
    "Attachment too large. Choose a smaller file.",
  "ext.error.attachmentCacheFull":
    "Attachment cache full. Remove unneeded chat history.",
  "ext.error.transferInterrupted":
    "The attachment transfer was interrupted or failed its integrity check. Check the connection and retry.",
  "ext.prepareFailedDescription":
    "Preparation incomplete. The plugin will compile when opened.",
  "ext.uiUnavailable": "Interface unavailable. Your session is retained.",
  "ext.uiInitializationFailed":
    "Interface failed to load. Your session is retained.",
  "ext.uiInitializationTimeout":
    "Interface loading timed out. Your session is retained.",
  "ext.uiConnectionTimeout":
    "Interface connection timed out. Your session is retained.",
  "ext.recovery.title": "Extension archive recovery",
  "ext.recovery.checking": "Checking the extension archive…",
  "ext.recovery.checkHint":
    "Check for an archivable development-era registry without changing data.",
  "ext.recovery.checkAgain": "Check again",
  "ext.recovery.legacy":
    "Found {count} older installation records. Archive them to initialize the bundled extension.",
  "ext.recovery.current":
    "Registry version supported; no archiving needed. Refresh the list and check the package.",
  "ext.recovery.future":
    "Registry from a newer version. Upgrade the app; the original is preserved.",
  "ext.recovery.invalid":
    "Registry unrecognized; automatic archiving is unavailable. Keep the original directory for recovery.",
  "ext.recovery.unavailable":
    "Registry changes are unavailable during startup recovery, updates or shutdown. Check again afterward.",
  "ext.recovery.archive": "Archive and rebuild",
  "ext.recovery.confirmTitle": "Archive old extension installations?",
  "ext.recovery.confirmHint":
    "Move the complete old extension directory to an archive and reload the current bundled extension, disabled by default. App settings, notes, and plugin private data are retained. Old extension sessions require their original package version. The archive location will be shown after completion.",
  "ext.recovery.confirm": "Archive and rebuild",
  "ext.recovery.archiving": "Archiving…",
  "ext.recovery.archived": "The old extension directory was archived.",
  "ext.recovery.archiveLocation": "Archive location:",
  "ext.recovery.afterArchive":
    "The extension list will reload. Keep the archive if errors persist and refresh. Review and authorize bundled extensions to enable them.",
  "ext.market.discover": "Discover plugins",
  "ext.market.title": "Plugin market",
  "ext.market.hint":
    "Built-in plugins come with the app; online plugins are reviewed by the market maintainer. First installs require permission review; updates from the same source with unchanged permissions do not.",
  "ext.market.repository": "Market source",
  "ext.market.refresh": "Refresh",
  "ext.market.loading": "Loading market…",
  "ext.market.stale":
    "Refresh failed. Showing the last verified catalog; downloads will be rechecked.",
  "ext.market.search": "Search plugins",
  "ext.market.searchHint": "Name, author or keyword",
  "ext.market.category": "Category",
  "ext.market.category.all": "All categories",
  "ext.market.category.text": "Text",
  "ext.market.category.data": "Data",
  "ext.market.category.tools": "Utilities",
  "ext.market.category.games": "Games",
  "ext.market.bundled": "Built-in",
  "ext.market.currentVersion": "Installed {version}",

  "ext.market.download": "Install",
  "ext.market.hostRequired": "Requires app {version} or newer",
  "ext.market.preparing": "Preparing…",
  "ext.market.downloadProgress": "Downloading {percent}%",
  "ext.market.verifying": "Verifying…",
  "ext.market.installing": "Installing…",
  "ext.market.update": "Update",
  "ext.market.updateTo": "Update to {version}",
  "ext.market.installed": "Installed",
  "ext.market.newerInstalled": "Newer version installed",
  "ext.market.noMatches": "No matching plugins.",
  "ext.market.empty": "No plugins are currently listed.",
  "ext.market.notConfigured": "No market configured. Install a local package.",
  "ext.market.unavailable":
    "Market unavailable. Check your connection and refresh. Installed extensions remain available.",
  "ext.market.incompatible":
    "Market catalog incompatible. Upgrade the app or wait for a compatible catalog. Installed extensions and local installation remain available.",
  "ext.market.expired":
    "Market catalog expired. Refresh after the maintainer renews it. Installed extensions and local installation remain available.",
  "ext.market.invalid":
    "Market catalog or package verification failed. No extensions were installed or changed.",
  "ext.market.changed":
    "This version changed or was removed. Refresh and choose again.",
  "ext.installed": "Installed",
  "ext.open": "Open",
  "ext.openNamed": "Open {name}",
  "ext.details": "Details",
  "ext.actionsFor": "Actions for {name}",
  "ext.otherFeatures": "Other features",
  "ext.permissionNeeded": "Permission needed",
  "ext.advancedSettings": "Advanced settings",
  "ext.advancedSettingsFor": "{name} · Advanced settings",
  "ext.advancedSettingsHint":
    "Manage local plugin data and service connections.",
  "ext.technicalInfo": "Technical information",
  "ext.identifier": "Extension ID",
  "ext.technicalCommands": "Command formats",
  "ext.features": "Features",
  "ext.appSessionHint":
    "Navigation preserves progress. Export to restore with the same package version. Ending a session clears its inputs, progress and results; private storage survives restarts.",
  "ext.noPermissions": "None required.",
  "ext.appLoad": "Load app",
  "ext.appWorking": "Working…",
  "ext.appStatus": "Execution status",
  "ext.appExport": "Export session",
  "ext.appClose": "End session",
  "ext.sessionTools": "Extension tools",
  "ext.tools.interface": "Window and interface",
  "ext.tools.help": "About {name}",
  "ext.tools.session": "Session files",
  "ext.tools.lifecycle": "Session lifecycle",
  "ext.reloadUi": "Reload interface",
  "ext.appCloseTitle": "End this session?",
  "ext.appCloseDescription":
    "Ending clears unexported inputs, progress and results. Saved plugin data is retained. Export first or discard progress.",
  "ext.appDiscardClose": "Discard and end",
  "ext.appSaveClose": "Export and end",
  "ext.appExportHint":
    "Save inputs, state and results as JSON for the same command and exact package version. Reselect files; credentials are excluded.",
  "ext.appStopHint":
    "Request cancellation and wait for execution to stop. Inputs and the previous result are retained.",
  "ext.appCloseHint":
    "Clear this session and exit without disabling or uninstalling the extension.",
  "ext.fieldLimit": "Each field accepts up to {bytes} UTF-8 bytes.",
  "ext.fieldInvalid": "Correct this field before running.",
  "nav.extensions": "Extensions",
  "catalog.extensions":
    "Install tools and apps, and manage plugin permissions.",
  "ext.title": "Extensions",
  "ext.description": "Install, manage and use plugins.",
  "ext.dataBoundary": "Permissions and data",
  "ext.boundary":
    "Files are shared only after confirmation, network access is limited to declared services, and local data is isolated per plugin.",
  "ext.installFile": "Choose package",
  "ext.installLocal": "Install from file",
  "ext.packageHint":
    "Use .starter-extension.json, up to 24 MiB. Review permissions before installing. Preview, installation and enabling do not execute the plugin.",
  "ext.docs": "Developer docs",
  "ext.host": "Runtime",
  "ext.empty":
    "No extensions yet. Restore the built-in workbench or install a trusted local package.",
  "ext.review": "Install extension",
  "ext.author": "Author",
  "ext.version": "Version",
  "ext.permissions": "Permissions and data",
  "ext.install": "Install",
  "ext.installConsent":
    "Installation enables the extension with required and selected permissions. You can change them later.",
  "ext.upgrade": "Update",
  "ext.upgradeHint":
    "Installed {version}. Updating enables the extension and retains the previous version for rollback.",
  "ext.enable": "Enable",
  "ext.disable": "Disable",
  "ext.enabled": "Enabled",
  "ext.disabled": "Disabled",
  "ext.enableTitle": "Enable extension",
  "ext.trust":
    "I trust this source and agree to share authorized content. The author’s identity is unverified.",
  "ext.grantHint": "Review required permissions and select optional access.",
  "ext.permission.files:read": "Read selected files",
  "ext.permission.network:https": "Access declared services",
  "ext.allowedHosts": "Network origins and methods",
  "ext.uninstall": "Uninstall",
  "ext.uninstallTitle": "Uninstall this extension?",
  "ext.uninstallHint":
    "Uninstalling stops the extension, revokes credentials and removes installation records and cache. User files and private data remain; clear private data first if unwanted.",
  "ext.cancel": "Cancel",
  "ext.refresh": "Refresh",
  "ext.running": "Running: {id}",
  "ext.runner": "Run a tool",
  "ext.choose": "Choose command",
  "ext.noEnabled": "Install and enable an extension first.",
  "ext.input": "Input text",
  "ext.inputTooLong":
    "Text exceeds 1 MiB in UTF-8. Remove some content to continue.",
  "ext.inputHint":
    "Up to 1 MiB UTF-8, passed as data to the selected Wasm export.",
  "ext.files": "Files for this run",
  "ext.filesHint":
    "Up to 16 files totaling 2 MiB. Shares only names, media types and saved contents; binary data uses base64.",
  "ext.clearFiles": "Clear selection",
  "ext.url": "URL (optional)",
  "ext.urlHint":
    "Sending a URL asks the host for one GET to a declared origin. Plugins can make further authorized HTTP requests through the host broker; credentials are scoped to configured origins and aliases.",
  "ext.run": "Run",
  "ext.stop": "Stop",
  "ext.stopping": "Waiting for the extension to stop…",
  "ext.output": "Result",
  "ext.noOutput": "No result yet",
  "ext.export": "Export session",
  "ext.sessionHint":
    "Restore sessions only with the exact package version. Reselect files; credentials are excluded.",
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
  "experience.extensions": "Use extensions",
  "experience.extensionsHint":
    "Review permissions, install and run, then disable or uninstall as needed.",
  "experience.extensions.1": "Inspect the bundled workbench",
  "experience.extensions.1Hint":
    "Inspect the installed workbench’s features and permissions, or import a third-party Wasm package. Installation does not execute the plugin.",
  "experience.extensions.2": "Authorize and enable",
  "experience.extensions.2Hint":
    "Choose Install after review to authorize and enable. Enable the initially bundled workbench separately; its commands then appear in Quick actions.",
  "experience.extensions.3": "Run extensions",
  "experience.extensions.3Hint":
    "Open the workbench from the sidebar for text, CSV / JSON and tasks. Explicitly send files or request network data, open a native window or export the session.",
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
  "ext.permission.text:read": "Read submitted text",
  "ext.bundledHint":
    "The built-in workbench is installed. Enable it to open from the sidebar or a new window. Uninstalling does not trigger reinstallation.",
  "ext.hostData": "Share host data",
  "ext.hostDataHint":
    "Selected content is shared only when you choose Send data. Separately authorized networking and storage remain available.",
  "ext.sendData": "Send data",
  "ext.sendDataTitle": "Send data",
  "ext.sendDataMenu": "Send data…",
  "ext.openWindow": "New window",
  "ext.windowHint":
    "This window has its own session; the main window remains available.",
  "ext.entryUnavailable":
    "Extension disabled, uninstalled or command unavailable. Check Extensions.",
  "ext.minHostVersion": "Minimum host version",
  "ext.requiredPermissions": "Required permissions",
  "ext.optionalPermissions": "Optional permissions",
  "ext.optionalPermissionsHint":
    "Unselected permissions leave related features unavailable. You can change this later.",
  "ext.selectAllOptionalPermissions": "Select all",
  "ext.permissionAllowed": "Allowed",
  "ext.permissionNotAllowed": "Not allowed",
  "ext.permissionScopeHint":
    "Permissions apply to the whole extension. Network access allows it to send shared content to permitted services.",
  "ext.managePermissions": "Permissions",
  "ext.savePermissions": "Save",
  "ext.limitedCommands": "{available} of {total} features available.",
  "ext.permission.network:local": "Connect to local services",
  "ext.permission.storage": "Save extension data",
  "ext.queueSummary": "{count} queued or running operations",
  "ext.queued": "Queued…",
  "ext.storage": "Private data",
  "ext.storageHint":
    "Data is isolated per plugin and retained on uninstall. Clear it manually if needed.",
  "ext.storageUsage": "{entries} entries · {bytes} bytes",
  "ext.clearStorage": "Clear data",
  "ext.clearStorageHint":
    "Permanently delete this plugin’s private data. Current sessions and selected files remain. Stop active operations first.",
  "ext.credentials": "Service credentials",
  "ext.credentialsHint":
    "Use the alias specified by the plugin. Tokens go only to the selected origin and cannot be read by plugins or session exports. Saving the same alias replaces its key.",
  "ext.credentialOrigin": "Service origin",
  "ext.credentialAlias": "Credential alias",
  "ext.credentialSecret": "Secret / access token",
  "ext.saveCredential": "Save",
  "ext.deleteCredential": "Delete",
  "ext.deleteCredentialNamed": "Delete credential {alias}",
  "ext.deleteCredentialHint":
    "Delete credential {alias} for {origin}? It cannot be recovered here. Enter it again if the extension needs it later.",
  "ext.disabledPermissionsHint":
    "Disabled extensions have no active grants. Enable first to change permissions.",
  "ext.viewPermissions": "Permissions",
  "ext.rollback": "Roll back to {version}",
  "ext.rollbackTitle": "Roll back this extension?",
  "ext.rollbackHint":
    "Rollback disables the extension and requires permission review. Private data is retained but may be incompatible with the older version.",
  "ext.rollbackConfirm": "Roll back",
  "ext.importSession": "Import session",
  "ext.importSessionHint":
    "Replaces this command’s inputs, progress and results without running it or changing private data.",
  "ext.replaceSession": "Replace session",
  "ext.importFileHint": "Reselect these files before sending data:",
  "ext.sessionInvalid":
    "The session file is invalid, exceeds 8 MiB, or belongs to a different command or package version.",
  "ext.artifacts": "Generated files",
  "ext.saveArtifact": "Save {name}",
  "ext.saveResult": "Save result",
  "ext.switchCommand": "Switch command",
  "ext.switchCommandHint":
    "Discard the current command’s unexported inputs and result? Export the session first to keep them.",
  "ext.source": "Source",
  "ext.source.market": "Extension market",
  "ext.source.bundled": "Included with the app",
  "ext.source.local": "Local file",
  "ext.source.marketHint":
    "Package matches the market release. Author details are supplied by the publisher; this is not a safety guarantee.",
  "ext.source.bundledHint": "Author details are supplied by the extension.",
  "ext.source.localHint":
    "The file source and author identity have not been verified.",
  "ext.permission.messaging:lan": "Local network chat",
  "ext.permission.wallpapers:manage": "Manage gallery and app background",
  "ext.permission.network:images": "Download online images",
  "ext.permission.network:system-proxy": "Use system proxy",
  "ext.permission.links:open": "Open web pages",
  "ext.permission.window:control": "Keep window on top",
  "ext.reviewDescription": "Review the source and choose optional permissions.",
  "ext.updated": "Updated {name} to {version}.",
  "ext.permissionDescription.text:read":
    "Receives only text you enter and submit for an operation.",
  "ext.permissionDescription.files:read":
    "Receives only the contents of files you select and confirm sharing.",
  "ext.permissionDescription.network:https":
    "Sends and receives data through the declared internet services.",
  "ext.permissionDescription.network:local":
    "Connects to specified services on this computer, not other devices on the local network.",
  "ext.permissionDescription.storage":
    "Keeps unencrypted data on this computer across restarts and after uninstalling.",
  "ext.permissionDescription.messaging:lan":
    "Start or connect manually to exchange text, images and files and save history. You choose files to send or save. Traffic is unencrypted; peer identities are unverified.",
  "ext.permissionDescription.wallpapers:manage":
    "Imports, renames or deletes gallery images and changes this app’s background. Excludes desktop wallpaper and internet access.",
  "ext.permissionDescription.network:images":
    "Downloads, previews or saves images from any public HTTPS address. Image URLs can also send information to the website.",
  "ext.permissionDescription.network:system-proxy":
    "Routes permitted requests through the system proxy, which may be local or on a private network. Its final destination cannot be verified.",
  "ext.permissionDescription.links:open":
    "Opens public HTTPS pages in your default browser.",
  "ext.permissionDescription.window:control":
    "Reads or changes the always-on-top state of this extension’s own separate window.",
} as const;

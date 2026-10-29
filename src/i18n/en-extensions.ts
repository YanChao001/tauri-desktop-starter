export const enExtensions = {
  "ext.error.networkBlocked":
    "The destination resolved to a protected network address. Check the host network setting and proxy permission.",
  "ext.error.imageRedirect":
    "The source returned a redirect. Retry or switch image sources.",
  "ext.error.imageSourceRejected":
    "The source rejected the image request. Retry later or switch image sources.",
  "ext.error.imageInvalid":
    "The image format is unsupported or its contents are damaged. Choose another image.",
  "ext.error.imageTooLarge":
    "The image exceeds the size or decoding limit. Choose another image.",
  "ext.error.attachmentTooLarge":
    "The attachment exceeds its size limit. Choose a smaller file.",
  "ext.error.attachmentCacheFull":
    "The local attachment cache is full. Remove chat history you no longer need and retry.",
  "ext.error.transferInterrupted":
    "The attachment transfer was interrupted or failed its integrity check. Check the connection and retry.",
  "ext.prepareFailedDescription":
    "Plugin preparation did not finish. You can still open a plugin to compile it on demand.",
  "ext.uiUnavailable":
    "The extension interface is unavailable. Your session has been retained.",
  "ext.recovery.title": "Extension archive recovery",
  "ext.checkBundledUpdate": "Check built-in updates",
  "ext.bundledCurrent": "The bundled workbench is already up to date.",
  "ext.bundledNewerInstalled":
    "The installed workbench is newer than the bundled version. The installed package was retained.",
  "ext.bundledDifferent":
    "The installed workbench has the same version but different contents. The installed package was retained; a replacement needs a higher package version.",
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
    "Browse plugins reviewed by the market maintainer. Review details and permissions after downloading, then authorize, install and enable in one step.",
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
  "ext.market.hostRequired": "Requires app {version} or newer",
  "ext.market.preparing": "Preparing download…",
  "ext.market.downloadProgress": "Downloading {percent}%",
  "ext.market.verifying": "Verifying…",
  "ext.market.installing": "Installing…",
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
  "ext.details": "About and permissions",
  "ext.actionsFor": "More actions for {name}",
  "ext.otherFeatures": "Other features",
  "ext.permissionNeeded": "Permission needed",
  "ext.advancedSettings": "Advanced settings",
  "ext.advancedSettingsFor": "{name} · Advanced settings",
  "ext.advancedSettingsHint":
    "Manage this extension’s saved local data or service connections when needed.",
  "ext.technicalInfo": "Technical information",
  "ext.identifier": "Extension ID",
  "ext.technicalCommands": "Command formats",
  "ext.features": "Features",
  "ext.appSessionHint":
    "Navigation in this window preserves progress. Export a session to restore it later with the same package version. Plugin private storage survives restarts; ending a session clears only its inputs, progress and results.",
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
  "ext.fieldInvalid":
    "Correct this field's value before running the extension.",
  "nav.extensions": "Extensions",
  "catalog.extensions":
    "Add tools and apps, and choose what data and features each plugin can access.",
  "ext.title": "Extensions",
  "ext.description": "Find and manage plugins, then open your tools and apps.",
  "ext.dataBoundary": "Permissions and data",
  "ext.boundary":
    "Review and manage each plugin's permissions. Plugins receive only files you confirm, connect only to declared services, and keep their local data separate from other plugins.",
  "ext.installFile": "Choose extension package",
  "ext.installLocal": "Install a local extension",
  "ext.openPackageFile": "Open file",
  "ext.selectedPackageFile": "{name}; choose another file",
  "ext.packageHint":
    "Choose a .starter-extension.json package, up to 24 MiB. Review permissions, then install and enable. Preview, installation and enabling do not execute plugin code.",
  "ext.docs": "Developer docs",
  "ext.host": "Runtime",
  "ext.empty":
    "No extensions installed. Restore the bundled workbench or install a file from a source you trust.",
  "ext.review": "Review extension package",
  "ext.author": "Author",
  "ext.version": "Version",
  "ext.permissions": "Declared capabilities and host data access",
  "ext.install": "Install and enable",
  "ext.installConsent":
    "Confirmation enables the extension with required and selected optional permissions. You can change permissions or disable it later.",
  "ext.upgrade": "Update and enable",
  "ext.upgradeHint":
    "Installed version: {version}. Confirmation updates and enables the extension, keeping the previous version for rollback.",
  "ext.enable": "Enable",
  "ext.disable": "Disable",
  "ext.enabled": "Enabled",
  "ext.disabled": "Disabled",
  "ext.enableTitle": "Confirm trust and capabilities",
  "ext.trust":
    "I trust this extension’s source and agree to share the content I authorize. I understand that its author identity has not been verified.",
  "ext.grantHint": "Review required permissions and choose optional access.",
  "ext.permission.files:read": "Read selected files",
  "ext.permission.network:https": "Access declared services",
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
  "ext.inputTooLong":
    "Text exceeds 1 MiB in UTF-8. Remove some content to continue.",
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
  "experience.extensions.1": "Inspect the bundled workbench",
  "experience.extensions.1Hint":
    "Inspect the installed workbench’s features and permissions, or import a third-party Wasm package. Installation does not execute the plugin.",
  "experience.extensions.2": "Confirm trust and enable",
  "experience.extensions.2Hint":
    "Review and choose Install and enable to authorize. Enable the initially bundled workbench separately; commands then appear in the command palette.",
  "experience.extensions.3": "Run and inspect the result",
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
    "Local Workbench comes installed. Enable it to open from the sidebar or in a native window. Uninstalling it is permanent until you install it again.",
  "ext.hostData": "Host data · explicit transfer",
  "ext.hostDataHint":
    "Send selected data transfers these contents. Plugins may use separately authorized networking or private storage during ordinary actions.",
  "ext.sendData": "Send selected data",
  "ext.sendDataTitle": "Send data",
  "ext.sendDataMenu": "Send data…",
  "ext.openWindow": "Open in separate window",
  "ext.windowHint":
    "Use the title bar for language, theme, minimize, maximize and close. The main window stays usable. This window has its own session.",
  "ext.entryUnavailable":
    "This extension is disabled, uninstalled, or this app command no longer exists. Check its status in the extension center.",
  "ext.restoreLab": "Restore bundled workbench",
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
  "ext.managePermissions": "Manage permissions",
  "ext.savePermissions": "Save permissions",
  "ext.limitedCommands":
    "{available} of {total} features are available with current permissions.",
  "ext.permission.network:local": "Connect to local services",
  "ext.permission.storage": "Save extension data",
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
  "ext.deleteCredentialHint":
    "Delete credential {alias} for {origin}? It cannot be recovered here. Enter it again if the extension needs it later.",
  "ext.disabledPermissionsHint":
    "Disabled extensions have no active permissions. Enable this extension explicitly before changing its grants.",
  "ext.viewPermissions": "View permissions",
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

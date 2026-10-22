import type { zhSystem } from "./zh-system";
export const enSystem: Record<keyof typeof zhSystem, string> = {
  "lifecycle.title": "Save unfinished work",
  "lifecycle.description":
    "This action needs every window to be ready ({count} total). Save or finish your work first.",
  "lifecycle.save": "Save and continue",
  "lifecycle.discard": "Discard and continue",
  "lifecycle.saving": "Saving…",
  "lifecycle.executing":
    "All windows are ready. The operation is running and will continue automatically when finished.",
  "lifecycle.waiting":
    "This window is ready. Waiting for the other windows; you can still cancel the entire action.",
  "lifecycle.tasks":
    "Background tasks: save waits for completion; discard cancels tasks",
  "system.title": "System integration",
  "system.description":
    "Try native notifications, global shortcuts, deep links, file associations, clipboard and multi-window workspaces.",
  "system.notification": "Send system notification",
  "system.notificationBody":
    "A notification from the desktop demo. Background tasks can use the same system capability.",
  "system.shortcut": "Global shortcut",
  "system.register": "Register shortcut",
  "system.unregister": "Unregister shortcut",
  "system.shortcutHelp":
    "Once registered, the shortcut activates the main window even while another app is focused. Conflicts with other applications are reported.",
  "system.clipboard": "System clipboard",
  "system.writeClipboard": "Copy text",
  "system.readClipboard": "Read text",
  "system.deepLink": "Deep links and file associations",
  "system.deepLinkHelp":
    "Installed builds support {deepLink} and .{extension} files. Cold and repeated launch inputs appear below; the file workbench validates file content.",
  "system.events": "Launch and activation history",
  "system.empty": "No activation events received yet.",
  "system.window": "Open independent notes window",
  "system.restore": "Restore last workspace",
  "system.success": "Operation completed",
  "system.denied":
    "Notification permission was not granted. Check your system notification settings.",
  "system.permission":
    "Validate native notifications and file associations in an installed build on the target operating system.",
  "nav.system": "System integration",
  "nativeError.userCancelled":
    "Operation cancelled. Your unsaved work is preserved.",
  "nativeError.credentialError":
    "Cannot access the system credential store. Unlock the keychain or check the credential service and retry.",
};

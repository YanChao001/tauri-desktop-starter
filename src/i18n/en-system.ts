import type { zhSystem } from "./zh-system";
export const enSystem: Record<keyof typeof zhSystem, string> = {
  "nativeError.busy":
    "Too many native operations are running. Please try again shortly.",
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
    "Send notifications, set shortcuts, copy text, or work across multiple windows.",
  "system.notification": "Send system notification",
  "system.notificationBody":
    "This is a sample notification from the desktop app.",
  "system.shortcut": "Global shortcut",
  "system.register": "Enable shortcut",
  "system.unregister": "Disable shortcut",
  "system.shortcutHelp":
    "Once enabled, this shortcut opens the main window even while you use another app. You will be told if another application already uses it.",
  "system.clipboard": "System clipboard",
  "system.writeClipboard": "Copy text",
  "system.readClipboard": "Read text",
  "system.deepLink": "Open through links or files",
  "system.deepLinkHelp":
    "The installed app can open through {deepLink} links or .{extension} files. Received links and files appear below. The file workbench checks file contents.",
  "system.events": "Launch and activation history",
  "system.empty": "No new opening activity has been received yet.",
  "system.workspace": "Multi-window workspace",
  "system.window": "Open independent notes window",
  "system.restore": "Restore last workspace",
  "system.success": "Operation completed",
  "system.denied":
    "Notification permission was not granted. Check your system notification settings.",
  "system.permission":
    "Try system notifications and opening through files after installing the app. Behavior depends on your operating system.",
  "nav.system": "System integration",
  "nativeError.userCancelled":
    "Operation cancelled. Your unsaved work is preserved.",
  "nativeError.httpTimeout":
    "The network request timed out. Check your connection or proxy settings and retry.",
  "nativeError.credentialError":
    "Cannot access the system credential store. Unlock the keychain or check the credential service and retry.",
};

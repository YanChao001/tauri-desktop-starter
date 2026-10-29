import type { zhSystem } from "./zh-system";
export const enSystem: Record<keyof typeof zhSystem, string> = {
  "nativeError.clipboardWriteFailed": "Could not copy. Try again.",
  "nativeError.busy": "Too many operations are running. Try again shortly.",
  "lifecycle.title": "Save unfinished work",
  "lifecycle.description":
    "Save or finish your work first. All {count} windows must be ready to continue.",
  "lifecycle.save": "Save and continue",
  "lifecycle.discard": "Discard and continue",
  "lifecycle.saving": "Saving…",
  "lifecycle.executing": "All windows are ready. Running the action…",
  "lifecycle.waiting":
    "This window is ready. Waiting for the others; you can still cancel the action.",
  "lifecycle.tasks":
    "Background tasks: save waits for completion; discard cancels tasks",
  "system.title": "System integration",
  "system.description":
    "Use notifications, shortcuts, the clipboard and multiple windows.",
  "system.notificationLabel": "System notification",
  "system.notification": "Send notification",
  "system.notificationBody": "A sample notification from the desktop app.",
  "system.shortcut": "Global shortcut",
  "system.register": "Enable shortcut",
  "system.unregister": "Disable shortcut",
  "system.shortcutHelp":
    "Once enabled, this shortcut opens the main window from any app. Conflicts are reported.",
  "system.clipboard": "System clipboard",
  "system.writeClipboard": "Copy text",
  "system.readClipboard": "Read text",
  "system.deepLink": "Open through links or files",
  "system.deepLinkHelp":
    "The installed app opens {deepLink} links and .{extension} files.",
  "system.events": "Open history",
  "system.empty": "No opening activity yet.",
  "system.workspace": "Multi-window workspace",
  "system.window": "Open notes window",
  "system.restore": "Reopen last workspace",
  "system.success": "Operation completed",
  "system.denied":
    "Notification permission not granted. Check your system notification settings.",
  "system.permission":
    "Notification behavior varies by operating system. Check it after installation.",
  "nav.system": "System integration",
  "nativeError.userCancelled": "Cancelled. Your unsaved work is preserved.",
  "nativeError.httpTimeout":
    "Request timed out. Check your connection or proxy and retry.",
  "nativeError.credentialError":
    "Cannot access system credentials. Unlock the keychain or check the credential service, then retry.",
};

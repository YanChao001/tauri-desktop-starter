import { isMacOS } from "@/lib/platform";

export type Shortcut = {
  key: string;
  primary?: boolean;
  alt?: boolean;
  shift?: boolean;
  allowInEditable?: boolean;
};

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  );
}

/** 仅处理尚未消费且未处于输入法组合状态的应用快捷键 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut,
  mac = isMacOS(),
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    (!shortcut.allowInEditable && isEditableTarget(event.target))
  )
    return false;
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    (mac ? event.metaKey : event.ctrlKey) === !!shortcut.primary &&
    !(mac ? event.ctrlKey : event.metaKey) &&
    event.altKey === !!shortcut.alt &&
    event.shiftKey === !!shortcut.shift
  );
}

export function formatShortcut(shortcut: Shortcut, mac = isMacOS()): string {
  const key =
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return mac
    ? `${shortcut.alt ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${shortcut.primary ? "⌘" : ""}${key}`
    : [
        shortcut.primary && "Ctrl",
        shortcut.alt && "Alt",
        shortcut.shift && "Shift",
        key,
      ]
        .filter(Boolean)
        .join("+");
}

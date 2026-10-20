import type { LucideIcon } from "lucide-react";
import type { MessageKey as DictKey } from "@/i18n/zh-CN";
import type { Shortcut } from "./shortcuts";

export type CommandGroup =
  "navigation" | "appearance" | "window" | "help" | "tools";
export type CommandInvocation = {
  point?: { clientX: number; clientY: number };
};

export type AppCommand = {
  id: string;
  labelKey: DictKey;
  group: CommandGroup;
  icon?: LucideIcon;
  keywords?: readonly string[];
  keywordKeys?: readonly DictKey[];
  shortcuts?: readonly Shortcut[];
  available?: () => boolean;
  run: (invocation?: CommandInvocation) => void | Promise<unknown>;
};

export function commandAvailable(command: AppCommand): boolean {
  return command.available?.() ?? true;
}

import type { LucideIcon } from "lucide-react";
import type { MessageKey as DictKey } from "@/i18n/zh-CN";
import type { Shortcut } from "./shortcuts";

export type CommandGroup =
  "navigation" | "appearance" | "window" | "help" | "tools" | "content";
export type CommandInvocation = {
  point?: { clientX: number; clientY: number };
};

export type AppCommand = {
  id: string;
  labelKey: DictKey;
  /** 内容检索等动态命令的纯文本标题；固定命令继续使用词典键。 */
  label?: string;
  description?: string;
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

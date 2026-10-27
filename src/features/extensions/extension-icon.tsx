import {
  CalculatorIcon,
  Gamepad2Icon,
  NotebookPenIcon,
  PuzzleIcon,
  TerminalIcon,
  ImageIcon,
  MessagesSquareIcon,
} from "lucide-react";
import type { ExtensionIcon as IconName } from "@/lib/tauri";

const ICONS = {
  calculator: CalculatorIcon,
  gamepad: Gamepad2Icon,
  notebook: NotebookPenIcon,
  terminal: TerminalIcon,
  puzzle: PuzzleIcon,
  image: ImageIcon,
  "message-circle": MessagesSquareIcon,
};
export function resolveExtensionIcon(name?: IconName | null) {
  return ICONS[name ?? "puzzle"];
}
export function ExtensionIcon({
  name,
  className = "size-6",
}: {
  name?: IconName | null;
  className?: string;
}) {
  const Icon = resolveExtensionIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

import {
  CalculatorIcon,
  Gamepad2Icon,
  NotebookPenIcon,
  PuzzleIcon,
  TerminalIcon,
} from "lucide-react";
import type { ExtensionIcon as IconName } from "@/lib/tauri";

const ICONS = {
  calculator: CalculatorIcon,
  gamepad: Gamepad2Icon,
  notebook: NotebookPenIcon,
  terminal: TerminalIcon,
  puzzle: PuzzleIcon,
};
export function ExtensionIcon({
  name,
  className = "size-6",
}: {
  name?: IconName | null;
  className?: string;
}) {
  const Icon = ICONS[name ?? "puzzle"];
  return <Icon className={className} aria-hidden="true" />;
}

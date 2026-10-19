import type { LucideIcon } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { commandAvailable } from "@/commands/types";
import { formatShortcut } from "@/commands/shortcuts";
import { useCommands } from "@/providers/commands";
import { useI18n } from "@/providers/i18n";

export function CommandMenuItem({
  id,
  icon: Icon,
}: {
  id: string;
  icon?: LucideIcon;
}) {
  const { t } = useI18n();
  const { commands, execute } = useCommands();
  const command = commands.find((item) => item.id === id);
  if (!command) return null;
  return (
    <DropdownMenuItem
      disabled={!commandAvailable(command)}
      onSelect={() => void execute(id)}
    >
      {Icon ? <Icon /> : null}
      <span className="flex-1">{t(command.labelKey)}</span>
      {command.shortcuts?.[0] ? (
        <kbd className="ml-3 font-mono text-[10px] text-muted-foreground">
          {formatShortcut(command.shortcuts[0])}
        </kbd>
      ) : null}
    </DropdownMenuItem>
  );
}

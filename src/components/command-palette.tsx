import { Command } from "cmdk";
import { SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { commandAvailable, type CommandGroup } from "@/commands/types";
import { formatShortcut } from "@/commands/shortcuts";
import { useCommands } from "@/providers/commands";
import { useI18n, type DictKey } from "@/providers/i18n";

const GROUPS: Array<{ id: CommandGroup; labelKey: DictKey }> = [
  { id: "navigation", labelKey: "commands.groupNavigation" },
  { id: "appearance", labelKey: "commands.groupAppearance" },
  { id: "window", labelKey: "commands.groupWindow" },
  { id: "tools", labelKey: "commands.groupTools" },
  { id: "help", labelKey: "commands.groupHelp" },
];

export function CommandPalette() {
  const { t } = useI18n();
  const { commands, execute, paletteOpen, setPaletteOpen } = useCommands();
  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("commands.title")}</DialogTitle>
          <DialogDescription>{t("commands.description")}</DialogDescription>
        </DialogHeader>
        <Command loop label={t("commands.title")} className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-4 pr-12">
            <SearchIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Command.Input
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={t("commands.placeholder")}
              aria-label={t("commands.title")}
            />
          </div>
          <Command.List className="max-h-[min(60vh,24rem)] overflow-y-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("commands.empty")}
            </Command.Empty>
            {GROUPS.map((group) => {
              const items = commands.filter(
                (command) =>
                  command.id !== "command-palette" &&
                  command.group === group.id &&
                  commandAvailable(command),
              );
              if (!items.length) return null;
              return (
                <Command.Group
                  key={group.id}
                  heading={t(group.labelKey)}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {items.map((command) => (
                    <Command.Item
                      key={command.id}
                      value={command.id}
                      keywords={[
                        t(command.labelKey),
                        ...(command.keywords ?? []),
                        ...(command.keywordKeys?.map((key) => t(key)) ?? []),
                      ]}
                      className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                      onSelect={() => {
                        setPaletteOpen(false);
                        void execute(command.id);
                      }}
                    >
                      {command.icon ? (
                        <command.icon className="size-4" aria-hidden="true" />
                      ) : null}
                      <span className="flex-1">{t(command.labelKey)}</span>
                      {command.shortcuts?.[0] ? (
                        <kbd className="ml-4 font-mono text-[11px] text-muted-foreground">
                          {formatShortcut(command.shortcuts[0])}
                        </kbd>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

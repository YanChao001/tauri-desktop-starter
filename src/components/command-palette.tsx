import { Command } from "cmdk";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useContentSearch } from "@/features/content-search/use-content-search";
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
  { id: "content", labelKey: "search.content" },
  { id: "navigation", labelKey: "commands.groupNavigation" },
  { id: "appearance", labelKey: "commands.groupAppearance" },
  { id: "window", labelKey: "commands.groupWindow" },
  { id: "tools", labelKey: "commands.groupTools" },
  { id: "help", labelKey: "commands.groupHelp" },
];

export function CommandPalette() {
  const { t } = useI18n();
  const { commands, execute, paletteOpen, setPaletteOpen } = useCommands();
  const [query, setQuery] = useState("");
  const content = useContentSearch(query, paletteOpen);
  const { failed, retry } = content;
  const notifiedFailure = useRef(false);
  useEffect(() => {
    if (!paletteOpen || !failed) {
      notifiedFailure.current = false;
      return;
    }
    if (notifiedFailure.current) return;
    notifiedFailure.current = true;
    toast.error(t("search.failed"), {
      id: "command-palette-search",
      action: {
        label: t("common.retry"),
        onClick: () => {
          setPaletteOpen(true);
          setQuery(query);
          retry();
        },
      },
    });
  }, [paletteOpen, failed, retry, query, setPaletteOpen, t]);
  return (
    <Dialog
      open={paletteOpen}
      onOpenChange={(open) => {
        setPaletteOpen(open);
        if (!open) setQuery("");
      }}
    >
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("commands.title")}</DialogTitle>
          <DialogDescription>{t("commands.description")}</DialogDescription>
        </DialogHeader>
        <Command loop label={t("commands.title")} className="flex flex-col">
          <div className="flex items-center border-b px-4 py-1.5 pr-12">
            <div className="relative flex min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                data-surface="transparent"
                className="w-full min-w-0 bg-transparent pl-9 outline-none"
                aria-label={t("commands.title")}
              />
            </div>
          </div>
          <p
            className="mx-4 h-5 overflow-auto text-xs text-muted-foreground"
            role="status"
            tabIndex={content.tooLong ? 0 : undefined}
          >
            {content.tooLong
              ? t("search.limit")
              : content.loading
                ? t("search.loading")
                : ""}
          </p>
          <Command.List
            data-surface="transparent"
            className="h-[min(60vh,24rem)] overflow-y-auto p-2"
          >
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("commands.empty")}
            </Command.Empty>
            {GROUPS.map((group) => {
              const items = commands.filter(
                (command) =>
                  command.id !== "command-palette" &&
                  command.group === group.id &&
                  (group.id !== "content" || content.ids.has(command.id)) &&
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
                        command.label ?? t(command.labelKey),
                        ...(command.keywords ?? []),
                        ...(command.keywordKeys?.map((key) => t(key)) ?? []),
                      ]}
                      className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-(--surface-state-selected) data-[selected=true]:text-(--surface-selected-foreground)"
                      onSelect={() => {
                        setPaletteOpen(false);
                        setQuery("");
                        void execute(command.id);
                      }}
                    >
                      {command.icon ? (
                        <command.icon className="size-4" aria-hidden="true" />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {command.label ?? t(command.labelKey)}
                        </span>
                        {command.description ? (
                          <span className="block text-xs text-muted-foreground">
                            {command.description}
                          </span>
                        ) : null}
                      </span>
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

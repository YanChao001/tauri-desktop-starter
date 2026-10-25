import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import type { ExtensionInfo, MarketEntry } from "@/lib/tauri";
import {
  availableExtensionCommands,
  canRunExtensionCommand,
} from "./extension-model";
import { ExtensionDetails } from "./extension-details";
import { ExtensionIcon } from "./extension-icon";
import { ExtensionResources } from "./extension-resources";

export function ExtensionCard({
  item,
  busy,
  update,
  onOpen,
  onWindow,
  onEnable,
  onDisable,
  onPermissions,
  onUninstall,
  onRollback,
  onUpdate,
}: {
  item: ExtensionInfo;
  busy: boolean;
  update: MarketEntry | null;
  onOpen: (commandId?: string) => void;
  onWindow: (commandId: string) => void;
  onEnable: () => void;
  onDisable: () => void;
  onPermissions: () => void;
  onUninstall: () => void;
  onRollback: () => void;
  onUpdate: () => void;
}) {
  const { t } = useI18n();
  const [details, setDetails] = useState(false);
  const manifest = item.package.manifest;
  const commands = availableExtensionCommands(item);
  const windowCommand = commands.find(
    (command) => command.resultFormat === "view" && command.ui?.window,
  );
  return (
    <article className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-start gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!item.enabled) onEnable();
            else if (!commands.length) onPermissions();
            else onOpen();
          }}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-lg text-left text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("ext.openNamed", { name: manifest.name })}
        >
          <span className="shrink-0 rounded-2xl bg-primary/10 p-4 text-primary">
            <ExtensionIcon name={manifest.icon} className="size-8" />
          </span>
          <span className="min-w-0">
            <span className="block break-words font-semibold">
              {manifest.name}
            </span>
          </span>
        </button>
        <Badge variant={item.enabled ? "default" : "secondary"}>
          {t(item.enabled ? "ext.enabled" : "ext.disabled")}
        </Badge>
      </div>
      <p className="break-words text-sm leading-relaxed text-muted-foreground">
        {manifest.description}
      </p>
      {item.enabled && commands.length !== manifest.commands.length ? (
        <p className="text-xs text-muted-foreground">
          {t("ext.limitedCommands", {
            available: commands.length,
            total: manifest.commands.length,
          })}
        </p>
      ) : null}
      <details
        className="text-sm"
        onToggle={(event) => setDetails(event.currentTarget.open)}
      >
        <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {t("ext.details")}
        </summary>
        <div className="space-y-4 pt-3">
          <ExtensionDetails value={item.package} origin={item.origin} />
          {details ? (
            <ExtensionResources
              key={`${item.generation}:${item.package.sha256}:${manifest.version}`}
              item={item}
            />
          ) : null}
        </div>
      </details>
      {item.enabled && manifest.commands.length > 1 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t("ext.commands")}</h4>
          <div className="flex flex-wrap gap-2">
            {manifest.commands.map((command) => (
              <Button
                key={command.id}
                size="sm"
                variant="outline"
                disabled={busy || !canRunExtensionCommand(item, command)}
                title={
                  !canRunExtensionCommand(item, command)
                    ? t("ext.managePermissions")
                    : undefined
                }
                onClick={() => onOpen(command.id)}
              >
                {command.title}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {update ? (
          <Button variant="outline" disabled={busy} onClick={onUpdate}>
            {t("ext.market.updateTo", {
              version: update.package.manifest.version,
            })}
          </Button>
        ) : null}
        {item.enabled ? (
          <>
            <Button
              disabled={busy || !commands.length}
              onClick={() => onOpen()}
            >
              {t("ext.open")}
            </Button>
            {windowCommand ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onWindow(windowCommand.id)}
              >
                {t("ext.openWindow")}
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy} onClick={onPermissions}>
              {t("ext.managePermissions")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={onDisable}>
              {t("ext.disable")}
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={onEnable}>
            {t("ext.enable")}
          </Button>
        )}
        {item.previousPackage ? (
          <Button variant="outline" disabled={busy} onClick={onRollback}>
            {t("ext.rollback", {
              version: item.previousPackage.manifest.version,
            })}
          </Button>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={onUninstall}>
          {t("ext.uninstall")}
        </Button>
      </div>
    </article>
  );
}

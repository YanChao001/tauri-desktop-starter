import { useCallback, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { EllipsisIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [resourcesMounted, setResourcesMounted] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const manifest = item.package.manifest;
  const commands = availableExtensionCommands(item);
  const windowCommand = commands.find(
    (command) => command.resultFormat === "view" && command.ui?.window,
  );
  const hasResources =
    manifest.network.length > 0 ||
    [...manifest.permissions, ...manifest.optionalPermissions].includes(
      "storage",
    );
  function selectAction(action: () => void) {
    // 确认框记录持久存在的菜单按钮，关闭后可以准确恢复焦点。
    menuTrigger.current?.focus();
    action();
  }
  return (
    <article className="row-span-3 grid min-w-0 grid-cols-1 grid-rows-subgrid gap-4 rounded-xl border app-surface p-5">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="shrink-0 rounded-2xl bg-primary/10 p-4 text-primary">
            <ExtensionIcon name={manifest.icon} className="size-8" />
          </span>
          <h3 className="min-w-0 break-words font-semibold">{manifest.name}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={item.enabled ? "default" : "secondary"}>
            {t(item.enabled ? "ext.enabled" : "ext.disabled")}
          </Badge>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTrigger}
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={t("ext.actionsFor", { name: manifest.name })}
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              collisionPadding={12}
              className="w-64 max-w-[calc(100vw-1.5rem)]"
              aria-label={t("ext.actionsFor", { name: manifest.name })}
              onCloseAutoFocus={(event) => {
                if (document.activeElement?.closest('[role="dialog"]'))
                  event.preventDefault();
              }}
            >
              <DropdownMenuItem
                disabled={busy || (item.enabled && !commands.length)}
                onSelect={() =>
                  selectAction(item.enabled ? () => onOpen() : onEnable)
                }
              >
                {t(item.enabled ? "ext.open" : "ext.enable")}
              </DropdownMenuItem>
              {windowCommand ? (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() =>
                    selectAction(() => onWindow(windowCommand.id))
                  }
                >
                  {t("ext.openWindow")}
                </DropdownMenuItem>
              ) : null}
              {hasResources ? (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() =>
                    selectAction(() => {
                      setResourcesMounted(true);
                      setResourcesOpen(true);
                    })
                  }
                >
                  {t("ext.advancedSettings")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => selectAction(onPermissions)}
              >
                {t(
                  item.enabled
                    ? "ext.managePermissions"
                    : "ext.viewPermissions",
                )}
              </DropdownMenuItem>
              {item.enabled ? (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => selectAction(onDisable)}
                >
                  {t("ext.disable")}
                </DropdownMenuItem>
              ) : null}
              {update ? (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => selectAction(onUpdate)}
                >
                  {t("ext.market.updateTo", {
                    version: update.package.manifest.version,
                  })}
                </DropdownMenuItem>
              ) : null}
              {item.previousPackage ? (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => selectAction(onRollback)}
                >
                  {t("ext.rollback", {
                    version: item.previousPackage.manifest.version,
                  })}
                </DropdownMenuItem>
              ) : null}
              {item.enabled && manifest.commands.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>
                    {t("ext.otherFeatures")}
                  </DropdownMenuLabel>
                  {manifest.commands.map((command) => (
                    <DropdownMenuItem
                      key={command.id}
                      disabled={busy || !canRunExtensionCommand(item, command)}
                      aria-label={
                        canRunExtensionCommand(item, command)
                          ? command.title
                          : `${command.title} · ${t("ext.permissionNeeded")}`
                      }
                      onSelect={() => selectAction(() => onOpen(command.id))}
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {command.title}
                      </span>
                      {!canRunExtensionCommand(item, command) ? (
                        <span className="text-xs text-muted-foreground">
                          {t("ext.permissionNeeded")}
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onSelect={() => selectAction(onUninstall)}
              >
                {t("ext.uninstall")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="space-y-2">
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
      </div>
      <div className="space-y-3">
        <details className="text-sm">
          <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {t("ext.details")}
          </summary>
          <div className="space-y-4 pt-3">
            <ExtensionDetails
              value={item.package}
              origin={item.origin}
              showIdentity={false}
              grantedPermissions={item.grantedPermissions}
            />
          </div>
        </details>
      </div>
      {hasResources && resourcesMounted ? (
        <AdvancedSettingsDialog
          item={item}
          open={resourcesOpen}
          onOpenChange={setResourcesOpen}
          triggerRef={menuTrigger}
        />
      ) : null}
    </article>
  );
}

function AdvancedSettingsDialog({
  item,
  open,
  onOpenChange,
  triggerRef,
}: {
  item: ExtensionInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const [container] = useState(() => document.createElement("div"));
  const attachResources = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.appendChild(container);
    },
    [container],
  );
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-xl"
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("ext.advancedSettingsFor", {
                name: item.package.manifest.name,
              })}
            </DialogTitle>
            <DialogDescription>
              {t("ext.advancedSettingsHint")}
            </DialogDescription>
          </DialogHeader>
          <div ref={attachResources} />
        </DialogContent>
      </Dialog>
      {/* 关闭时容器脱离文档但组件继续存活，保留内存草稿且不强制挂载模态层。 */}
      {createPortal(
        <ExtensionResources
          key={`${item.generation}:${item.package.sha256}:${item.package.manifest.version}`}
          item={item}
        />,
        container,
      )}
    </>
  );
}

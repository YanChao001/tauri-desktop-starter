import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { PackagePlusIcon, RefreshCwIcon } from "lucide-react";
import { NativePage, ResourceError } from "@/components/native-page";
import { ExternalLink } from "@/components/external-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExtensions } from "@/features/extensions/extensions-provider";
import { extensionPath } from "@/routes";
import { useI18n } from "@/providers/i18n";
import { nativeErrorText } from "@/lib/native-error";
import { ExtensionDetails } from "@/features/extensions/extension-details";
import { ExtensionRunner } from "@/features/extensions/extension-runner";
import { ExtensionRecovery } from "@/features/extensions/extension-recovery";
import { ExtensionCard } from "@/features/extensions/extension-card";
import { availableExtensionCommands } from "@/features/extensions/extension-model";
import { ExtensionMarket } from "@/features/extensions/extension-market";
import { useExtensionMarket } from "@/features/extensions/use-extension-market";
import {
  compareExtensionVersions,
  marketUpdate,
} from "@/features/extensions/market-model";
import { repositoryFileUrl } from "@/features/catalog/model";
import { APP_CONFIG } from "@/config/app";
import {
  previewExtension,
  downloadMarketExtension,
  extensionDemo,
  installExtension,
  installMarketExtension,
  rollbackExtension,
  type MarketSource,
  setExtensionEnabled,
  uninstallExtension,
  isTauri,
  openExtensionWindow,
  type ExtensionInfo,
  type ExtensionPermission,
  type ExtensionPreview,
} from "@/lib/tauri";

type Review = {
  preview: ExtensionPreview;
  content: string;
  revision: number;
  previous: string | null;
  source?: MarketSource;
};
type Decision = {
  item: ExtensionInfo;
  revision: number;
  action: "enable" | "permissions" | "uninstall" | "rollback";
};

export default function Extensions() {
  const { t } = useI18n();
  const [search, setSearch] = useSearchParams();
  const { data, loading, error, reload } = useExtensions();
  const market = useExtensionMarket();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<unknown>(null);
  const [bundledStatus, setBundledStatus] = useState<
    "current" | "newer" | "different" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const alive = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [grants, setGrants] = useState<ExtensionPermission[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const tab = search.get("tab") === "discover" ? "discover" : "installed";
  const requestedExtension = search.get("extension") ?? "";
  const [runnerOpened, setRunnerOpened] = useState(!!requestedExtension);
  useEffect(() => {
    if (!requestedExtension) return;
    setRunnerOpened(true);
    const frame = requestAnimationFrame(() =>
      document
        .getElementById("extension-runner")
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [requestedExtension]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function act(action: () => Promise<void>) {
    if (locked.current || !isTauri()) return;
    locked.current = true;
    setBusy(true);
    setActionError(null);
    setBundledStatus(null);
    try {
      await action();
    } catch (reason) {
      if (alive.current) setActionError(reason);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function reviewPackage(value: Review) {
    const current = data?.items.find(
      (item) => item.package.manifest.id === value.preview.manifest.id,
    );
    setGrants(
      current?.grantedPermissions.filter((permission) =>
        value.preview.manifest.optionalPermissions.includes(permission),
      ) ?? [],
    );
    setReview(value);
  }
  function consentFor(value: ExtensionPreview) {
    return {
      trusted: true,
      grantedPermissions: [
        ...value.manifest.permissions,
        ...grants.filter((permission) =>
          value.manifest.optionalPermissions.includes(permission),
        ),
      ],
    };
  }
  async function inspect(file?: File) {
    if (!data) return;
    dialogTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const snapshot = data;
    await act(async () => {
      let content: string = "";
      if (file) {
        if (file.size > 24 * 1024 * 1024)
          throw new Error(t("ext.packageError"));
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(
            await file.arrayBuffer(),
          );
        } catch {
          throw new Error(t("ext.packageError"));
        }
      }
      if (!file) content = await extensionDemo("starter.extension-lab");
      const preview = await previewExtension(content);
      const installed = snapshot.items.find(
        (item) => item.package.manifest.id === preview.manifest.id,
      );
      if (!file && installed) {
        const order = compareExtensionVersions(
          preview.manifest.version,
          installed.package.manifest.version,
        );
        if (order <= 0) {
          if (alive.current)
            setBundledStatus(
              order < 0
                ? "newer"
                : installed.package.sha256 === preview.sha256
                  ? "current"
                  : "different",
            );
          return;
        }
      }
      if (alive.current)
        reviewPackage({
          preview,
          content,
          revision: snapshot.revision,
          previous: installed?.package.manifest.version ?? null,
        });
    });
  }
  function decide(item: ExtensionInfo, action: Decision["action"]) {
    if (!data || busy) return;
    dialogTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setActionError(null);
    setGrants(action === "permissions" ? item.grantedPermissions : []);
    setDecision({ item, action, revision: data.revision });
  }
  async function inspectMarket(entry: import("@/lib/tauri").MarketEntry) {
    if (!data) return;
    dialogTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const snapshot = data;
    await act(async () => {
      setDownloadingId(entry.package.manifest.id);
      try {
        const downloaded = await downloadMarketExtension(
          entry.package.manifest.id,
          entry.packageSha256,
        );
        if (alive.current)
          reviewPackage({
            content: downloaded.content,
            preview: downloaded.preview,
            source: downloaded.source,
            revision: snapshot.revision,
            previous:
              snapshot.items.find(
                (item) =>
                  item.package.manifest.id === entry.package.manifest.id,
              )?.package.manifest.version ?? null,
          });
      } finally {
        if (alive.current) setDownloadingId(null);
      }
    });
  }
  function open(item: ExtensionInfo, commandId?: string) {
    const commands = availableExtensionCommands(item);
    const command = commandId
      ? commands.find((command) => command.id === commandId)
      : commands[0];
    if (command && command.resultFormat === "view") {
      navigate(extensionPath(item.package.manifest.id, command.id));
      return;
    }
    if (command)
      setSearch({ extension: item.package.manifest.id, command: command.id });
    if (command?.resultFormat !== "view")
      document
        .getElementById("extension-runner")
        ?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  const dialogOpen = review !== null || decision !== null;
  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    const trigger = dialogTrigger.current;
    if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus();
    else document.getElementById("extension-package")?.focus();
  }
  return (
    <NativePage title={t("ext.title")} description={t("ext.description")}>
      <details className="rounded-lg border bg-card px-4 py-3 text-sm">
        <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("ext.dataBoundary")}
        </summary>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          {t("ext.boundary")}
        </p>
      </details>
      <ResourceError error={error} retry={() => void reload()} />
      <ExtensionRecovery error={error} reload={reload} />
      {!dialogOpen ? (
        <ResourceError
          error={actionError}
          retry={() => {
            setActionError(null);
            void reload();
          }}
        />
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setSearch(
            (current) => {
              const next = new URLSearchParams(current);
              if (value === "discover") next.set("tab", "discover");
              else next.delete("tab");
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="installed">{t("ext.installed")}</TabsTrigger>
          <TabsTrigger value="discover">{t("ext.market.discover")}</TabsTrigger>
        </TabsList>
        <TabsContent
          value="installed"
          forceMount
          hidden={tab !== "installed"}
          className="space-y-5 pt-4"
        >
          {data?.runs.length ? (
            <p role="status" className="text-sm">
              {t("ext.queueSummary", { count: data.runs.length })}
            </p>
          ) : null}
          <h3 className="font-semibold">{t("ext.installed")}</h3>
          {data?.items.some(
            (item) => item.package.manifest.id === "starter.extension-lab",
          ) ? (
            <p className="text-sm text-muted-foreground">
              {t("ext.bundledHint")}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {data?.items.map((item) => (
              <ExtensionCard
                key={item.package.manifest.id}
                item={item}
                busy={busy}
                update={
                  marketUpdate(market.data?.catalog.entries ?? [], item) ?? null
                }
                onOpen={(commandId) => open(item, commandId)}
                onWindow={(commandId) =>
                  void act(() =>
                    openExtensionWindow(
                      item.package.manifest.id,
                      commandId,
                      item.package.sha256,
                      item.generation,
                    ),
                  )
                }
                onEnable={() => decide(item, "enable")}
                onPermissions={() => decide(item, "permissions")}
                onUninstall={() => decide(item, "uninstall")}
                onRollback={() => decide(item, "rollback")}
                onUpdate={() => {
                  const update = marketUpdate(
                    market.data?.catalog.entries ?? [],
                    item,
                  );
                  if (update) void inspectMarket(update);
                }}
                onDisable={() =>
                  void act(async () => {
                    await setExtensionEnabled(
                      item.package.manifest.id,
                      false,
                      [],
                      data.revision,
                      false,
                    );
                    await reload();
                  })
                }
              />
            ))}
          </div>
          {data && !data.items.length ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t("ext.empty")}
            </p>
          ) : null}
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <PackagePlusIcon className="size-5" />
                {t("ext.installFile")}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || loading}
                onClick={() => void reload()}
                aria-label={t("ext.refresh")}
              >
                <RefreshCwIcon className="size-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("ext.packageHint")}
            </p>
            <Label htmlFor="extension-package">{t("ext.installFile")}</Label>
            <Input
              id="extension-package"
              type="file"
              accept=".json,application/json"
              disabled={!data || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void inspect(file);
              }}
            />
            <Button
              variant="outline"
              disabled={!data || busy}
              onClick={() => void inspect()}
            >
              {t(
                data?.items.some(
                  (item) =>
                    item.package.manifest.id === "starter.extension-lab",
                )
                  ? "ext.checkBundledUpdate"
                  : "ext.restoreLab",
              )}
            </Button>
            {bundledStatus ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t(
                  bundledStatus === "current"
                    ? "ext.bundledCurrent"
                    : bundledStatus === "newer"
                      ? "ext.bundledNewerInstalled"
                      : "ext.bundledDifferent",
                )}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("ext.host")}:{" "}
              <code className="break-all">Extism / WebAssembly</code>
            </p>
            <ExternalLink
              className="text-sm text-primary underline underline-offset-4"
              href={repositoryFileUrl(
                APP_CONFIG.repositoryUrl,
                "docs/extensions.md",
              )}
              target="_blank"
              rel="noreferrer"
            >
              {t("ext.docs")}
            </ExternalLink>
          </section>
          {data && runnerOpened ? (
            <div id="extension-runner">
              <ExtensionRunner
                items={data.items}
                runs={data.runs}
                onSettled={reload}
                requestedExtension={search.get("extension") ?? ""}
                requestedCommand={search.get("command") ?? ""}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent
          value="discover"
          forceMount
          hidden={tab !== "discover"}
          className="pt-4"
        >
          <ExtensionMarket
            snapshot={market.data}
            loading={market.loading}
            error={market.error}
            busy={busy || !data}
            downloadingId={downloadingId}
            installed={data?.items ?? []}
            onRefresh={() => void market.reload()}
            onDownload={(entry) => void inspectMarket(entry)}
          />
        </TabsContent>
      </Tabs>
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setReview(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={restoreDialogFocus}
        >
          <DialogHeader>
            <DialogTitle>{t("ext.review")}</DialogTitle>
            <DialogDescription>{t("ext.packageHint")}</DialogDescription>
          </DialogHeader>
          {review ? (
            <>
              <ExtensionDetails
                value={review.preview}
                consent={{ grants, disabled: busy, onChange: setGrants }}
                origin={
                  review.source
                    ? { kind: "market", source: review.source }
                    : { kind: "local" }
                }
              />
              <p className="text-sm text-muted-foreground">
                {t("ext.installConsent")}
              </p>
              {review.previous ? (
                <p className="rounded-md bg-muted p-3 text-sm">
                  {t("ext.upgradeHint", { version: review.previous })}
                </p>
              ) : null}
            </>
          ) : null}
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(actionError, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setActionError(null);
              }}
            >
              {t("ext.cancel")}
            </Button>
            <Button
              disabled={busy || !review}
              onClick={() => {
                if (review)
                  void act(async () => {
                    if (review.source)
                      await installMarketExtension(
                        review.content,
                        review.revision,
                        review.previous !== null,
                        review.preview.sha256,
                        review.source,
                        consentFor(review.preview),
                      );
                    else
                      await installExtension(
                        review.content,
                        review.revision,
                        review.previous !== null,
                        review.preview.sha256,
                        consentFor(review.preview),
                      );
                    if (alive.current) setReview(null);
                    await reload();
                  });
              }}
            >
              {t(review?.previous ? "ext.upgrade" : "ext.install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDecision(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={restoreDialogFocus}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                decision?.action === "rollback"
                  ? "ext.rollbackTitle"
                  : decision?.action === "uninstall"
                    ? "ext.uninstallTitle"
                    : "ext.enableTitle",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                decision?.action === "rollback"
                  ? "ext.rollbackHint"
                  : decision?.action === "uninstall"
                    ? "ext.uninstallHint"
                    : "ext.grantHint",
              )}
            </DialogDescription>
          </DialogHeader>
          {decision ? (
            <ExtensionDetails
              consent={
                ["enable", "permissions"].includes(decision.action)
                  ? { grants, disabled: busy, onChange: setGrants }
                  : undefined
              }
              value={
                decision.action === "rollback" && decision.item.previousPackage
                  ? decision.item.previousPackage
                  : decision.item.package
              }
              origin={
                decision.action === "rollback"
                  ? (decision.item.previousOrigin ?? undefined)
                  : decision.item.origin
              }
            />
          ) : null}
          {decision && ["enable", "permissions"].includes(decision.action) ? (
            <p className="text-sm text-muted-foreground">
              {t("ext.installConsent")}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(actionError, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDecision(null);
                setActionError(null);
              }}
            >
              {t("ext.cancel")}
            </Button>
            <Button
              variant={
                decision?.action === "uninstall" ? "destructive" : "default"
              }
              disabled={busy || !decision}
              onClick={() => {
                if (decision)
                  void act(async () => {
                    if (
                      decision.action === "enable" ||
                      decision.action === "permissions"
                    )
                      await setExtensionEnabled(
                        decision.item.package.manifest.id,
                        true,
                        consentFor(decision.item.package).grantedPermissions,
                        decision.revision,
                        true,
                      );
                    else if (decision.action === "rollback")
                      await rollbackExtension(
                        decision.item.package.manifest.id,
                        decision.revision,
                      );
                    else
                      await uninstallExtension(
                        decision.item.package.manifest.id,
                        decision.revision,
                      );
                    if (alive.current) setDecision(null);
                    await reload();
                  });
              }}
            >
              {t(
                decision?.action === "uninstall"
                  ? "ext.uninstall"
                  : decision?.action === "rollback"
                    ? "ext.rollbackConfirm"
                    : decision?.action === "permissions"
                      ? "ext.savePermissions"
                      : "ext.enable",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NativePage>
  );
}

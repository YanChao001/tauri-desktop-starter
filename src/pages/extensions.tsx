import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ExternalLinkIcon,
  FolderOpenIcon,
  PackagePlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { NativePage, ResourceError } from "@/components/native-page";
import { PageLoading } from "@/components/page-loading";
import { ExternalLink } from "@/components/external-link";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
import { ExtensionHelp } from "@/features/extensions/extension-help";
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
  type MarketDownloadProgress,
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
  const packageInput = useRef<HTMLInputElement>(null);
  const packageTrigger = useRef<HTMLButtonElement>(null);
  const [packageFileName, setPackageFileName] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [grants, setGrants] = useState<ExtensionPermission[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<MarketDownloadProgress | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  useEffect(() => {
    if (actionError)
      toast.error(nativeErrorText(actionError, t), { id: "extensions:action" });
  }, [actionError, t]);
  useEffect(() => {
    if (bundledStatus)
      toast.info(
        t(
          bundledStatus === "current"
            ? "ext.bundledCurrent"
            : bundledStatus === "newer"
              ? "ext.bundledNewerInstalled"
              : "ext.bundledDifferent",
        ),
        { id: "extensions:action" },
      );
  }, [bundledStatus, t]);
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
    dialogTrigger.current = file
      ? packageTrigger.current
      : document.activeElement instanceof HTMLElement
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
      setDownloadProgress(null);
      let receiving = true;
      try {
        const downloaded = await downloadMarketExtension(
          entry.package.manifest.id,
          entry.packageSha256,
          (progress) => {
            if (alive.current && receiving) setDownloadProgress(progress);
          },
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
        receiving = false;
        if (alive.current) {
          setDownloadingId(null);
          setDownloadProgress(null);
        }
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
  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    const trigger = dialogTrigger.current;
    if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus();
    else packageTrigger.current?.focus();
  }
  const disabledPermissions =
    decision?.action === "permissions" && !decision.item.enabled;
  return (
    <NativePage title={t("ext.title")} description={t("ext.description")}>
      <ResourceError error={error} retry={() => void reload()} />
      <ExtensionRecovery error={error} reload={reload} />
      <Tabs
        className="gap-4"
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
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="installed">{t("ext.installed")}</TabsTrigger>
            <TabsTrigger value="discover">
              {t("ext.market.discover")}
            </TabsTrigger>
          </TabsList>
          <ExtensionHelp label={t("ext.dataBoundary")}>
            {t("ext.boundary")}
          </ExtensionHelp>
          <span
            role="status"
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            {data?.runs.length
              ? t("ext.queueSummary", { count: data.runs.length })
              : ""}
          </span>
          {tab === "installed" ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={busy || loading}
                    onClick={() => void reload()}
                    aria-label={t("ext.refresh")}
                  >
                    <RefreshCwIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("ext.refresh")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        <TabsContent
          value="installed"
          forceMount
          hidden={tab !== "installed"}
          className="space-y-4"
          aria-busy={loading}
        >
          {!data && loading ? <PageLoading /> : null}
          <div className="extension-card-grid">
            {data?.items.map((item) => (
              <ExtensionCard
                key={item.package.manifest.id}
                item={item}
                busy={busy}
                update={
                  marketUpdate(
                    market.data?.catalog.entries ?? [],
                    item,
                    market.data?.hostVersion ?? "0.0.0",
                  ) ?? null
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
                    market.data?.hostVersion ?? "0.0.0",
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
          className="space-y-4"
        >
          <section
            aria-labelledby="extension-install-title"
            className="@container/install flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border app-surface p-4"
          >
            <h3 className="flex items-center gap-2 font-semibold">
              <PackagePlusIcon className="size-5 shrink-0" aria-hidden="true" />
              <span id="extension-install-title">{t("ext.installLocal")}</span>
              <ExtensionHelp label={t("ext.installLocal")}>
                {t("ext.packageHint")}
              </ExtensionHelp>
            </h3>
            <TooltipProvider delayDuration={650} skipDelayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={packageTrigger}
                    type="button"
                    variant="outline"
                    className="max-w-[min(100%,16rem)] min-w-0 shrink justify-start"
                    disabled={!data || busy}
                    aria-label={
                      packageFileName
                        ? t("ext.selectedPackageFile", {
                            name: packageFileName,
                          })
                        : t("ext.openPackageFile")
                    }
                    onClick={() => packageInput.current?.click()}
                  >
                    <FolderOpenIcon className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      {packageFileName || t("ext.openPackageFile")}
                    </span>
                  </Button>
                </TooltipTrigger>
                {packageFileName ? (
                  <TooltipContent
                    side="bottom"
                    collisionPadding={8}
                    className="max-w-[min(22rem,var(--radix-tooltip-content-available-width))] whitespace-normal break-words leading-relaxed"
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {packageFileName}
                    </span>
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
            <input
              ref={packageInput}
              id="extension-package"
              type="file"
              hidden
              aria-label={t("ext.installFile")}
              accept=".json,application/json"
              disabled={!data || busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) {
                  setPackageFileName(file.name);
                  void inspect(file);
                }
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost">
                    <ExternalLink
                      href={repositoryFileUrl(
                        APP_CONFIG.repositoryUrl,
                        "docs/extensions.md",
                      )}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("ext.docs")}
                    >
                      <ExternalLinkIcon aria-hidden="true" />
                      <span className="hidden @2xl/install:inline">
                        {t("ext.docs")}
                      </span>
                    </ExternalLink>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("ext.docs")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </section>
          <ExtensionMarket
            snapshot={market.data}
            loading={market.loading}
            error={market.error}
            busy={busy || !data}
            downloadingId={downloadingId}
            downloadProgress={downloadProgress}
            installingId={installingId}
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
          closeLabel={t("common.close")}
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
                <p data-surface="control" className="rounded-md p-3 text-sm">
                  {t("ext.upgradeHint", { version: review.previous })}
                </p>
              ) : null}
            </>
          ) : null}
          {actionError ? (
            <p role="alert" className="sr-only">
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
              aria-busy={installingId !== null}
              onClick={() => {
                if (review)
                  void act(async () => {
                    setInstallingId(review.preview.manifest.id);
                    try {
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
                    } finally {
                      if (alive.current) setInstallingId(null);
                    }
                  });
              }}
            >
              <span className="grid">
                <span
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1"
                >
                  {t(review?.previous ? "ext.upgrade" : "ext.install")}
                </span>
                <span
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1"
                >
                  {t("ext.market.installing")}
                </span>
                <span className="col-start-1 row-start-1" aria-live="polite">
                  {t(
                    installingId
                      ? "ext.market.installing"
                      : review?.previous
                        ? "ext.upgrade"
                        : "ext.install",
                  )}
                </span>
              </span>
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
          closeLabel={t("common.close")}
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
                    : decision?.action === "permissions"
                      ? disabledPermissions
                        ? "ext.viewPermissions"
                        : "ext.managePermissions"
                      : "ext.enableTitle",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                decision?.action === "rollback"
                  ? "ext.rollbackHint"
                  : decision?.action === "uninstall"
                    ? "ext.uninstallHint"
                    : disabledPermissions
                      ? "ext.disabledPermissionsHint"
                      : "ext.grantHint",
              )}
            </DialogDescription>
          </DialogHeader>
          {decision ? (
            <ExtensionDetails
              consent={
                ["enable", "permissions"].includes(decision.action) &&
                !disabledPermissions
                  ? { grants, disabled: busy, onChange: setGrants }
                  : undefined
              }
              grantedPermissions={decision.item.grantedPermissions}
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
          {decision &&
          ["enable", "permissions"].includes(decision.action) &&
          !disabledPermissions ? (
            <p className="text-sm text-muted-foreground">
              {t("ext.installConsent")}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="sr-only">
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
              {t(disabledPermissions ? "common.close" : "ext.cancel")}
            </Button>
            {!disabledPermissions ? (
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
                          decision.action === "enable" || decision.item.enabled,
                          decision.action === "enable" || decision.item.enabled
                            ? consentFor(decision.item.package)
                                .grantedPermissions
                            : [],
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
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NativePage>
  );
}

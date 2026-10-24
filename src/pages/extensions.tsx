import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { PackagePlusIcon, RefreshCwIcon } from "lucide-react";
import { NativePage, ResourceError } from "@/components/native-page";
import { ExternalLink } from "@/components/external-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import {
  ExtensionDetails,
  PERMISSION_LABELS,
} from "@/features/extensions/extension-details";
import { ExtensionRunner } from "@/features/extensions/extension-runner";
import { ExtensionIcon } from "@/features/extensions/extension-icon";
import { ExtensionMarket } from "@/features/extensions/extension-market";
import { useExtensionMarket } from "@/features/extensions/use-extension-market";
import { marketUpdate } from "@/features/extensions/market-model";
import { repositoryFileUrl } from "@/features/catalog/model";
import { APP_CONFIG } from "@/config/app";
import {
  previewExtension,
  downloadMarketExtension,
  extensionDemo,
  installExtension,
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
};
type Decision = {
  item: ExtensionInfo;
  revision: number;
  action: "enable" | "uninstall";
};

export default function Extensions() {
  const { t } = useI18n();
  const [search, setSearch] = useSearchParams();
  const { data, loading, error, reload } = useExtensions();
  const market = useExtensionMarket();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const alive = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [grants, setGrants] = useState<ExtensionPermission[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const tab = search.get("tab") === "discover" ? "discover" : "installed";
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
    try {
      await action();
    } catch (reason) {
      if (alive.current) setActionError(reason);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
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
      if (alive.current)
        setReview({
          preview,
          content,
          revision: snapshot.revision,
          previous:
            snapshot.items.find(
              (item) => item.package.manifest.id === preview.manifest.id,
            )?.package.manifest.version ?? null,
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
    setTrusted(false);
    setGrants([]);
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
          setReview({
            content: downloaded.content,
            preview: downloaded.preview,
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
  function open(item: ExtensionInfo) {
    const command = item.package.manifest.commands[0];
    if (command && item.package.manifest.resultFormat === "view") {
      navigate(extensionPath(item.package.manifest.id, command.id));
      return;
    }
    if (command)
      setSearch({ extension: item.package.manifest.id, command: command.id });
    if (item.package.manifest.resultFormat !== "view")
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
      <p className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        {t("ext.boundary")}
      </p>
      <ResourceError error={error} retry={() => void reload()} />
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
            {data &&
            !data.items.some(
              (item) => item.package.manifest.id === "starter.extension-lab",
            ) ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void inspect()}
              >
                {t("ext.restoreLab")}
              </Button>
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
          {data?.runningId ? (
            <p role="status" className="text-sm">
              {t("ext.running", { id: data.runningId })}
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
              <article
                key={item.package.manifest.id}
                className="min-w-0 space-y-4 rounded-xl border bg-card p-5"
              >
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      item.enabled ? open(item) : decide(item, "enable")
                    }
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("ext.openNamed", {
                      name: item.package.manifest.name,
                    })}
                  >
                    <span className="shrink-0 rounded-2xl bg-primary/10 p-4 text-primary">
                      <ExtensionIcon
                        name={item.package.manifest.icon}
                        className="size-8"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words font-semibold">
                        {item.package.manifest.name}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                        {item.package.manifest.description}
                      </span>
                    </span>
                  </button>
                  <Badge variant={item.enabled ? "default" : "secondary"}>
                    {t(item.enabled ? "ext.enabled" : "ext.disabled")}
                  </Badge>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    {t("ext.details")}
                  </summary>
                  <div className="pt-3">
                    <ExtensionDetails value={item.package} />
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const update = marketUpdate(
                      market.data?.catalog.entries ?? [],
                      item,
                    );
                    return update ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void inspectMarket(update)}
                      >
                        {t("ext.market.updateTo", {
                          version: update.package.manifest.version,
                        })}
                      </Button>
                    ) : null;
                  })()}
                  {item.enabled ? (
                    <Button disabled={busy} onClick={() => open(item)}>
                      {t("ext.open")}
                    </Button>
                  ) : null}
                  {item.enabled &&
                  item.package.manifest.ui?.window &&
                  item.package.manifest.commands[0] ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          openExtensionWindow(
                            item.package.manifest.id,
                            item.package.manifest.commands[0]!.id,
                            item.package.sha256,
                          ),
                        )
                      }
                    >
                      {t("ext.openWindow")}
                    </Button>
                  ) : null}
                  {item.enabled ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
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
                    >
                      {t("ext.disable")}
                    </Button>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => decide(item, "enable")}
                    >
                      {t("ext.enable")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => decide(item, "uninstall")}
                  >
                    {t("ext.uninstall")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {data && !data.items.length ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t("ext.empty")}
            </p>
          ) : null}
          {data &&
          (data.items.length === 0 ||
            data.items.some(
              (item) => item.package.manifest.resultFormat !== "view",
            )) ? (
            <div id="extension-runner">
              <ExtensionRunner
                items={data.items}
                runningId={data.runningId}
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
              <ExtensionDetails value={review.preview} />
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
                    await installExtension(
                      review.content,
                      review.revision,
                      review.previous !== null,
                      review.preview.sha256,
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
                decision?.action === "enable"
                  ? "ext.enableTitle"
                  : "ext.uninstallTitle",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                decision?.action === "enable"
                  ? "ext.grantHint"
                  : "ext.uninstallHint",
              )}
            </DialogDescription>
          </DialogHeader>
          {decision ? <ExtensionDetails value={decision.item.package} /> : null}
          {decision?.action === "enable" ? (
            <div className="space-y-4">
              <p className="text-sm">{t("ext.boundary")}</p>
              <Label className="items-start leading-relaxed">
                <Checkbox
                  checked={trusted}
                  disabled={busy}
                  onCheckedChange={(value) => setTrusted(value === true)}
                />
                {t("ext.trust")}
              </Label>
              {decision.item.package.manifest.permissions.map((permission) => (
                <Label key={permission} className="items-start leading-relaxed">
                  <Checkbox
                    checked={grants.includes(permission)}
                    disabled={busy}
                    onCheckedChange={(value) =>
                      setGrants((current) =>
                        value === true
                          ? [...new Set([...current, permission])]
                          : current.filter((item) => item !== permission),
                      )
                    }
                  />
                  {t(PERMISSION_LABELS[permission])}
                </Label>
              ))}
            </div>
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
              disabled={
                busy ||
                !decision ||
                (decision.action === "enable" &&
                  (!trusted ||
                    grants.length !==
                      decision.item.package.manifest.permissions.length))
              }
              onClick={() => {
                if (decision)
                  void act(async () => {
                    if (decision.action === "enable")
                      await setExtensionEnabled(
                        decision.item.package.manifest.id,
                        true,
                        grants,
                        decision.revision,
                        trusted,
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
                  : "ext.enable",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NativePage>
  );
}

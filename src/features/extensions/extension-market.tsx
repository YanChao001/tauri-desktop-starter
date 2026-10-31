import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  DownloadIcon,
  BookOpenIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResourceError } from "@/components/native-page";
import { ExternalLink } from "@/components/external-link";
import { APP_CONFIG } from "@/config/app";
import { repositoryFileUrl } from "@/features/catalog/model";
import { useI18n } from "@/providers/i18n";
import type {
  ExtensionInfo,
  BundledExtensionCatalog,
  MarketDownloadProgress,
  MarketEntry,
  MarketSnapshot,
} from "@/lib/tauri";
import { ExtensionIcon } from "./extension-icon";
import {
  compareExtensionVersions,
  extensionCatalogEntries,
  type ExtensionCatalogEntry,
} from "./market-model";
import { ExtensionHelp } from "./extension-help";
import { nativeErrorText } from "@/lib/native-error";

export function ExtensionMarket({
  snapshot,
  bundled = null,
  bundledLoading = false,
  bundledError = null,
  loading,
  error,
  busy,
  downloadingId,
  downloadProgress,
  installingId,
  installed,
  onRefresh,
  onDownload,
  onInstallBundled,
  installActions,
}: {
  snapshot: MarketSnapshot | null;
  bundled?: BundledExtensionCatalog | null;
  bundledLoading?: boolean;
  bundledError?: unknown;
  loading: boolean;
  error: unknown;
  busy: boolean;
  downloadingId: string | null;
  downloadProgress: MarketDownloadProgress | null;
  installingId: string | null;
  installed: readonly ExtensionInfo[];
  onRefresh: () => void;
  onDownload: (entry: MarketEntry) => void;
  onInstallBundled: (
    entry: ExtensionCatalogEntry & { kind: "bundled" },
  ) => void;
  installActions?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    if (snapshot && error)
      toast.error(nativeErrorText(error, t), {
        id: `extension-market:${id}`,
        action: { label: t("common.retry"), onClick: () => refresh.current() },
      });
  }, [snapshot, error, t, id]);
  const needle = query.trim().toLocaleLowerCase();
  const catalog = extensionCatalogEntries(bundled, snapshot);
  const entries = catalog.filter(
    (entry) =>
      (category === "all" || entry.category === category) &&
      [
        entry.package.manifest.name,
        entry.package.manifest.id,
        entry.package.manifest.description,
        entry.package.manifest.author,
      ].some((text) => text.toLocaleLowerCase().includes(needle)),
  );
  const incompatibleEntries = (snapshot?.incompatibleEntries ?? []).filter(
    (entry) =>
      (category === "all" || entry.category === category) &&
      [entry.name, entry.id].some((text) =>
        text.toLocaleLowerCase().includes(needle),
      ),
  );
  const statusMessage =
    loading || bundledLoading
      ? t("ext.market.loading")
      : snapshot && (snapshot.stale || error)
        ? t("ext.market.stale")
        : "";
  return (
    <section
      aria-label={t("ext.market.title")}
      aria-busy={loading || bundledLoading}
      className="@container/market space-y-4"
    >
      <div className="space-y-3 rounded-xl border app-surface p-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="flex shrink-0 items-center gap-2 text-sm font-semibold">
            <ShieldCheckIcon
              className="size-4 text-primary"
              aria-hidden="true"
            />
            {t("ext.market.title")}
            <ExtensionHelp label={t("ext.market.title")}>
              {t("ext.market.hint")}
            </ExtensionHelp>
          </h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p
                  role="status"
                  tabIndex={statusMessage ? 0 : undefined}
                  className="min-w-0 flex-1 truncate rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {statusMessage}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                {statusMessage}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon">
                    <ExternalLink
                      href={repositoryFileUrl(
                        APP_CONFIG.repositoryUrl,
                        "docs/extensions.md",
                      )}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("ext.docs")}
                    >
                      <BookOpenIcon aria-hidden="true" />
                    </ExternalLink>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("ext.docs")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("ext.market.refresh")}
                    disabled={loading || bundledLoading || busy}
                    onClick={onRefresh}
                  >
                    <RefreshCwIcon aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("ext.market.refresh")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <ResourceError error={!snapshot ? error : null} retry={onRefresh} />
        <ResourceError error={bundledError} retry={onRefresh} />
        <div
          className={cn(
            "grid gap-2",
            installActions
              ? "grid-cols-[minmax(0,1fr)_auto] @sm/market:grid-cols-[minmax(0,1fr)_9rem_auto] @xl/market:grid-cols-[minmax(0,1fr)_12rem_auto]"
              : "grid-cols-[minmax(0,1fr)_9rem] @xl/market:grid-cols-[minmax(0,1fr)_12rem]",
          )}
        >
          <div
            className={cn(
              "relative min-w-0",
              installActions && "col-span-full @sm/market:col-span-1",
            )}
          >
            <Label htmlFor={`${id}-search`} className="sr-only">
              {t("ext.market.search")}
            </Label>
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("ext.market.searchHint")}
              className="pl-9"
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor={`${id}-category`} className="sr-only">
              {t("ext.market.category")}
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id={`${id}-category`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {(["all", "text", "data", "tools", "games"] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {t(`ext.market.category.${value}`)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          {installActions ? (
            <div className="flex min-w-0 items-center justify-end">
              {installActions}
            </div>
          ) : null}
        </div>
      </div>
      <div className="extension-card-grid">
        {entries.map((entry) => {
          const manifest = entry.package.manifest;
          const hostVersion =
            entry.kind === "bundled"
              ? bundled?.hostVersion
              : snapshot?.hostVersion;
          const compatible =
            compareExtensionVersions(
              hostVersion ?? "0.0.0",
              manifest.minHostVersion,
            ) >= 0;
          const current = installed.find(
            (item) => item.package.manifest.id === manifest.id,
          );
          const difference = current
            ? compareExtensionVersions(
                manifest.version,
                current.package.manifest.version,
              )
            : 1;
          const downloadLabel = t(
            !current
              ? "ext.market.download"
              : difference > 0
                ? "ext.market.update"
                : difference < 0
                  ? "ext.market.newerInstalled"
                  : "ext.market.installed",
          );
          const downloading = downloadingId === manifest.id;
          const installing = installingId === manifest.id;
          const active = downloading || installing;
          const progress = downloading ? downloadProgress : null;
          const percent =
            progress?.phase === "downloading" && progress.totalBytes > 0
              ? Math.min(
                  100,
                  Math.floor(
                    (progress.receivedBytes / progress.totalBytes) * 100,
                  ),
                )
              : null;
          const activeLabel = installing
            ? t("ext.market.installing")
            : progress?.phase === "verifying"
              ? t("ext.market.verifying")
              : percent !== null
                ? t("ext.market.downloadProgress", { percent })
                : t("ext.market.preparing");
          const fillPercent =
            installing || progress?.phase === "verifying"
              ? 100
              : (percent ?? 0);
          return (
            <article
              key={`${entry.kind}:${manifest.id}`}
              tabIndex={-1}
              className="row-span-3 grid min-w-0 grid-rows-subgrid gap-4 rounded-xl border app-surface p-4"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 rounded-xl bg-primary/10 p-3 text-primary">
                  <ExtensionIcon name={manifest.icon} className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold wrap-anywhere">
                    {manifest.name}
                  </h4>
                  <p className="mt-1 text-sm leading-relaxed wrap-anywhere text-muted-foreground">
                    {manifest.description}
                  </p>
                </div>
                {entry.kind === "bundled" ? (
                  <Badge variant="secondary">{t("ext.market.bundled")}</Badge>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-start gap-2 self-start text-xs wrap-anywhere text-muted-foreground">
                <span>v{manifest.version}</span>
                <span>· {manifest.author}</span>
                <span>· {t(`ext.market.category.${entry.category}`)}</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 self-end">
                {!compatible || current ? (
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {!compatible
                      ? t("ext.market.hostRequired", {
                          version: manifest.minHostVersion,
                        })
                      : current
                        ? t("ext.market.currentVersion", {
                            version: current.package.manifest.version,
                          })
                        : null}
                  </p>
                ) : null}
                <Button
                  disabled={busy || active || difference <= 0 || !compatible}
                  aria-busy={active}
                  className={cn(
                    "relative ml-auto overflow-hidden",
                    active &&
                      "bg-primary/10 text-foreground disabled:opacity-100",
                  )}
                  onClick={() =>
                    entry.kind === "bundled"
                      ? onInstallBundled(entry)
                      : onDownload(entry)
                  }
                >
                  {active ? (
                    <span
                      data-slot="market-download-progress"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-0 bg-primary/20"
                      style={{ width: `${fillPercent}%` }}
                    />
                  ) : null}
                  <DownloadIcon className="relative size-4" />
                  <span className="relative grid">
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1"
                    >
                      {downloadLabel}
                    </span>
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1"
                    >
                      {t("ext.market.downloadProgress", { percent: 100 })}
                    </span>
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1"
                    >
                      {t("ext.market.preparing")}
                    </span>
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1"
                    >
                      {t("ext.market.verifying")}
                    </span>
                    <span
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1"
                    >
                      {t("ext.market.installing")}
                    </span>
                    <span className="col-start-1 row-start-1">
                      {active ? activeLabel : downloadLabel}
                    </span>
                  </span>
                </Button>
                {active ? (
                  <span
                    role="progressbar"
                    aria-label={manifest.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent ?? undefined}
                    aria-valuetext={activeLabel}
                    className="sr-only"
                  />
                ) : null}
              </div>
            </article>
          );
        })}
        {incompatibleEntries.map((entry) => (
          <article
            key={entry.id}
            className="min-w-0 space-y-3 rounded-xl border app-surface p-4"
          >
            <h4 className="font-semibold wrap-anywhere">{entry.name}</h4>
            <p className="text-sm wrap-anywhere text-muted-foreground">
              {t("ext.market.hostRequired", { version: entry.minHostVersion })}
            </p>
            <p className="text-xs wrap-anywhere text-muted-foreground">
              {entry.id} · v{entry.version}
            </p>
          </article>
        ))}
      </div>
      {(snapshot || bundled) &&
      !loading &&
      !bundledLoading &&
      entries.length === 0 &&
      incompatibleEntries.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          {t(
            catalog.length + (snapshot?.incompatibleEntries?.length ?? 0)
              ? "ext.market.noMatches"
              : "ext.market.empty",
          )}
        </p>
      ) : null}
    </section>
  );
}

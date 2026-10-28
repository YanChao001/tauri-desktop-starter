import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
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
import { useI18n } from "@/providers/i18n";
import type {
  ExtensionInfo,
  MarketDownloadProgress,
  MarketEntry,
  MarketSnapshot,
} from "@/lib/tauri";
import { ExtensionIcon } from "./extension-icon";
import { compareExtensionVersions } from "./market-model";
import { ExtensionHelp } from "./extension-help";
import { nativeErrorText } from "@/lib/native-error";

export function ExtensionMarket({
  snapshot,
  loading,
  error,
  busy,
  downloadingId,
  downloadProgress,
  installingId,
  installed,
  onRefresh,
  onDownload,
}: {
  snapshot: MarketSnapshot | null;
  loading: boolean;
  error: unknown;
  busy: boolean;
  downloadingId: string | null;
  downloadProgress: MarketDownloadProgress | null;
  installingId: string | null;
  installed: readonly ExtensionInfo[];
  onRefresh: () => void;
  onDownload: (entry: MarketEntry) => void;
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
  const entries = (snapshot?.catalog.entries ?? [])
    .filter(
      (entry) =>
        (category === "all" || entry.category === category) &&
        [
          entry.package.manifest.name,
          entry.package.manifest.id,
          entry.package.manifest.description,
          entry.package.manifest.author,
        ].some((text) => text.toLocaleLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        a.package.manifest.name.localeCompare(b.package.manifest.name),
    );
  const incompatibleEntries = (snapshot?.incompatibleEntries ?? []).filter(
    (entry) =>
      (category === "all" || entry.category === category) &&
      [entry.name, entry.id].some((text) =>
        text.toLocaleLowerCase().includes(needle),
      ),
  );
  const statusMessage = loading
    ? t("ext.market.loading")
    : snapshot && (snapshot.stale || error)
      ? t("ext.market.stale")
      : "";
  return (
    <section
      aria-label={t("ext.market.title")}
      aria-busy={loading}
      className="@container/market space-y-4"
    >
      <div className="space-y-3 rounded-xl border app-surface p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldCheckIcon className="size-5 shrink-0 text-primary" />
            {t("ext.market.title")}
            <ExtensionHelp label={t("ext.market.title")}>
              {t("ext.market.hint")}
            </ExtensionHelp>
          </h3>
          <div className="flex items-center gap-2">
            {APP_CONFIG.extensionMarket.repository ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild variant="ghost">
                      <ExternalLink
                        href={`https://github.com/${APP_CONFIG.extensionMarket.repository}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t("ext.market.repository")}
                      >
                        <ExternalLinkIcon className="size-4" />
                        <span className="hidden @2xl/market:inline">
                          {t("ext.market.repository")}
                        </span>
                      </ExternalLink>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("ext.market.repository")}
                    {snapshot ? (
                      <p className="mt-1 text-xs">
                        {t("ext.market.revision", {
                          revision: snapshot.catalog.revision,
                        })}
                      </p>
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            <Button
              variant="outline"
              disabled={loading || busy}
              onClick={onRefresh}
            >
              <RefreshCwIcon className="size-4" />
              {t("ext.market.refresh")}
            </Button>
          </div>
        </div>
        <ResourceError error={!snapshot ? error : null} retry={onRefresh} />
        <div className="grid gap-3 @xl/market:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="min-w-0 space-y-1.5">
            <div className="flex h-6 min-w-0 items-center gap-3">
              <Label htmlFor={`${id}-search`} className="shrink-0">
                {t("ext.market.search")}
              </Label>
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
            </div>
            <Input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("ext.market.searchHint")}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex h-6 items-center">
              <Label htmlFor={`${id}-category`}>
                {t("ext.market.category")}
              </Label>
            </div>
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
        </div>
      </div>
      <div className="extension-card-grid">
        {entries.map((entry) => {
          const manifest = entry.package.manifest;
          const compatible =
            snapshot !== null &&
            compareExtensionVersions(
              snapshot.hostVersion ?? "0.0.0",
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
          const downloadLabel = !compatible
            ? t("ext.market.hostRequired", { version: manifest.minHostVersion })
            : t(
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
              key={manifest.id}
              className="row-span-3 grid min-w-0 grid-rows-subgrid gap-4 rounded-xl border app-surface p-5"
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
                {entry.featured ? (
                  <Badge variant="secondary">{t("ext.market.featured")}</Badge>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-start gap-2 self-start text-xs wrap-anywhere text-muted-foreground">
                <span>v{manifest.version}</span>
                <span>· {manifest.author}</span>
                <span>· {t(`ext.market.category.${entry.category}`)}</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 self-end">
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  {!compatible
                    ? t("ext.market.hostRequired", {
                        version: manifest.minHostVersion,
                      })
                    : current
                      ? t("ext.market.currentVersion", {
                          version: current.package.manifest.version,
                        })
                      : t("ext.market.installHint")}
                </p>
                <Button
                  disabled={busy || active || difference <= 0 || !compatible}
                  aria-busy={active}
                  className={cn(
                    "relative overflow-hidden",
                    active &&
                      "bg-primary/10 text-foreground disabled:opacity-100",
                  )}
                  onClick={() => onDownload(entry)}
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
            className="min-w-0 space-y-3 rounded-xl border app-surface p-5"
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
      {snapshot && entries.length === 0 && incompatibleEntries.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          {t(
            snapshot.catalog.entries.length +
              (snapshot.incompatibleEntries?.length ?? 0)
              ? "ext.market.noMatches"
              : "ext.market.empty",
          )}
        </p>
      ) : null}
    </section>
  );
}

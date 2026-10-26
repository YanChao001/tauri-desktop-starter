import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
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
import type { ExtensionInfo, MarketEntry, MarketSnapshot } from "@/lib/tauri";
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
  installed,
  onRefresh,
  onDownload,
}: {
  snapshot: MarketSnapshot | null;
  loading: boolean;
  error: unknown;
  busy: boolean;
  downloadingId: string | null;
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
  return (
    <section
      aria-label={t("ext.market.title")}
      aria-busy={loading}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShieldCheckIcon className="size-5 text-primary" />
            {t("ext.market.title")}
            <ExtensionHelp label={t("ext.market.title")}>
              {t("ext.market.hint")}
            </ExtensionHelp>
          </h3>
          {APP_CONFIG.extensionMarket.repository ? (
            <ExternalLink
              href={`https://github.com/${APP_CONFIG.extensionMarket.repository}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
            >
              {t("ext.market.repository")}
              <ExternalLinkIcon className="size-3.5" />
            </ExternalLink>
          ) : null}
        </div>
        <Button
          variant="outline"
          disabled={loading || busy}
          onClick={onRefresh}
        >
          <RefreshCwIcon className="size-4" />
          {t("ext.market.refresh")}
        </Button>
      </div>
      <ResourceError error={!snapshot ? error : null} retry={onRefresh} />
      <p
        role="status"
        className="h-5 truncate text-sm text-muted-foreground"
        title={
          snapshot && (snapshot.stale || error)
            ? t("ext.market.stale")
            : undefined
        }
      >
        {loading
          ? t("ext.market.loading")
          : snapshot && (snapshot.stale || error)
            ? t("ext.market.stale")
            : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-search`}>{t("ext.market.search")}</Label>
          <Input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("ext.market.searchHint")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-category`}>{t("ext.market.category")}</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id={`${id}-category`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
      <div className="grid gap-4 lg:grid-cols-2">
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
          return (
            <article
              key={manifest.id}
              className="row-span-3 grid min-w-0 grid-rows-subgrid gap-4 rounded-xl border bg-card p-5"
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
                  disabled={busy || difference <= 0 || !compatible}
                  aria-busy={downloadingId === manifest.id}
                  onClick={() => onDownload(entry)}
                >
                  <DownloadIcon className="size-4" />
                  <span className="grid">
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
                      {t("ext.market.downloading")}
                    </span>
                    <span className="col-start-1 row-start-1">
                      {downloadingId === manifest.id
                        ? t("ext.market.downloading")
                        : downloadLabel}
                    </span>
                  </span>
                </Button>
              </div>
            </article>
          );
        })}
        {incompatibleEntries.map((entry) => (
          <article
            key={entry.id}
            className="min-w-0 space-y-3 rounded-xl border bg-card p-5"
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
      {snapshot ? (
        <p className="text-xs text-muted-foreground">
          {t("ext.market.revision", { revision: snapshot.catalog.revision })}
        </p>
      ) : null}
    </section>
  );
}

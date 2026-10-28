import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DownloadIcon,
  RotateCcwIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
} from "lucide-react";
import { ExternalLink } from "@/components/external-link";
import { SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { getLocale } from "@/i18n/registry";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { APP_CONFIG } from "@/config/app";
import { useUpdates, checkUpdates, installUpdate } from "@/lib/updates-store";
import { isTauri, relaunchApp, type UpdateStatus } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { version as buildVersion } from "../../package.json";

const ReleaseNotesMarkdown = lazy(() =>
  import("@/components/safe-markdown").then(({ SafeMarkdown }) => ({
    default: SafeMarkdown,
  })),
);

export function UpdateSettings() {
  const { t, language } = useI18n();
  const native = isTauri();
  const { settings, update } = useSettings();
  const latest = useLatestTranslator();
  const { phase, operationId, status, progress, error } = useUpdates();
  const [confirmInstall, setConfirmInstall] = useState<number | null>(null);
  const installingRef = useRef(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<Pick<
    UpdateStatus,
    "version" | "body"
  > | null>(null);
  const [restarting, setRestarting] = useState(false);
  const configured =
    status?.configured ?? Boolean(APP_CONFIG.updates.publicKey);
  const checkedAt = status?.checkedAt
    ? new Date(status.checkedAt).toLocaleString(
        getLocale(language).documentLang,
      )
    : null;
  const restartingRef = useRef(false);
  const mounted = useRef(false);
  const notifiedError = useRef<unknown>(null);
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!native || !error) notifiedError.current = null;
    else if (!engaged) return;
    else if (notifiedError.current !== error) {
      notifiedError.current = error;
      toast.error(nativeErrorText(error, latest), {
        id: "updates-error",
        action: {
          label: latest("common.retry"),
          onClick: () => void checkUpdates(),
        },
      });
    }
  }, [error, latest, native, engaged]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = ["checking", "downloading", "installing"].includes(phase);
  const percent = progress?.total
    ? Math.min(
        100,
        Math.round(((progress.downloaded ?? 0) / progress.total) * 100),
      )
    : undefined;
  const statusMessage = !native
    ? t("updates.browserOnly")
    : phase === "downloading"
      ? t("updates.downloading", {
          progress:
            percent === undefined
              ? `${Math.round((progress?.downloaded ?? 0) / 1024)} KB`
              : `${percent}%`,
        })
      : phase === "installing"
        ? t("updates.installing")
        : phase === "installed"
          ? t("updates.installed")
          : status && !status.configured
            ? t("updates.notConfigured")
            : phase === "checking"
              ? t("updates.checking")
              : phase === "error"
                ? nativeErrorText(error, t)
                : status?.available
                  ? t("updates.available", { version: status.version ?? "" })
                  : phase === "ready" && status
                    ? t("updates.latest")
                    : !configured
                      ? t("updates.notConfigured")
                      : t("updates.idle");
  async function install() {
    if (
      installingRef.current ||
      !native ||
      phase !== "ready" ||
      confirmInstall !== operationId
    )
      return;
    setEngaged(true);
    installingRef.current = true;
    setConfirmInstall(null);
    try {
      await installUpdate();
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      installingRef.current = false;
    }
  }
  async function restart() {
    if (!native || restartingRef.current) return;
    setEngaged(true);
    restartingRef.current = true;
    setRestarting(true);
    try {
      await relaunchApp();
    } catch (reason) {
      restartingRef.current = false;
      if (mounted.current) {
        toast.error(nativeErrorText(reason, latest));
        setRestarting(false);
      }
    }
  }
  return (
    <section
      id="settings-updates"
      tabIndex={-1}
      aria-label={t("updates.title")}
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onFocusCapture={() => setEngaged(true)}
      onPointerDownCapture={() => setEngaged(true)}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("updates.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative pb-1.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-3 gap-y-1">
                <h3
                  id="settings-updates-version"
                  tabIndex={-1}
                  className="max-w-full shrink-0 rounded-sm text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("updates.current", {
                    version: status?.currentVersion ?? buildVersion,
                  })}
                </h3>
                <p
                  role="status"
                  tabIndex={0}
                  className={`max-h-20 min-w-[min(100%,12rem)] flex-[1_1_12rem] overflow-auto break-words rounded-sm text-sm leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${native && (phase === "error" || !configured) ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {statusMessage}
                </p>
              </div>
              <div
                className="flex flex-wrap items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id="settings-updates-check"
                tabIndex={-1}
                data-testid="updates-actions"
              >
                {status?.available ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setReleaseNotes({
                        version: status.version,
                        body: status.body,
                      })
                    }
                  >
                    {t("updates.releaseNotes")}
                  </Button>
                ) : null}
                <Button
                  className="min-w-40"
                  variant={
                    status?.available || phase === "installed"
                      ? "outline"
                      : "default"
                  }
                  onClick={() => {
                    if (native) {
                      setEngaged(true);
                      void checkUpdates();
                    }
                  }}
                  disabled={!native || busy || phase === "installed"}
                  data-testid="check-updates"
                >
                  {t(
                    phase === "error"
                      ? "common.retry"
                      : phase === "checking"
                        ? "updates.checking"
                        : "updates.check",
                  )}
                </Button>
                {native && phase === "installed" ? (
                  <Button onClick={() => setConfirmRestart(true)}>
                    <RotateCcwIcon />
                    {t("updates.restart")}
                  </Button>
                ) : native && status?.available ? (
                  <Button
                    onClick={() => setConfirmInstall(operationId)}
                    disabled={busy}
                  >
                    <DownloadIcon />
                    {t("updates.install")}
                  </Button>
                ) : null}
              </div>
            </div>
            {native && phase === "downloading" ? (
              <Progress
                className="absolute inset-x-0 bottom-0 h-1"
                value={percent}
                aria-label={t("updates.install")}
              />
            ) : null}
          </div>
          <div className="border-t [&>.settings-row]:py-3">
            <SettingRow
              id="settings-updates-auto"
              icon={RefreshCwIcon}
              label={
                <label htmlFor="auto-check-updates">
                  {t("updates.autoCheck")}
                </label>
              }
              hint={t("updates.autoCheckHint")}
              helpLabel={`${t("updates.autoCheck")} · ${t("title.help")}`}
            >
              <Switch
                id="auto-check-updates"
                checked={settings.autoCheckUpdates}
                disabled={!native}
                onCheckedChange={(autoCheckUpdates) => {
                  if (native) update({ autoCheckUpdates });
                }}
              />
            </SettingRow>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-3">
            <details className="min-w-0 flex-1 basis-44 text-xs text-muted-foreground">
              <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("updates.endpoint")}
              </summary>
              <div className="mt-3 space-y-2">
                <p>{t("updates.configurationDescription")}</p>
                <p>
                  {t(
                    configured ? "updates.keyConfigured" : "updates.keyMissing",
                  )}
                </p>
                <p className="break-all font-mono">
                  {status
                    ? (status.endpoint ?? t("updates.endpointDisabled"))
                    : APP_CONFIG.updates.endpoint}
                </p>
                {checkedAt ? (
                  <p>{t("updates.lastChecked", { time: checkedAt })}</p>
                ) : null}
              </div>
            </details>
            <ExternalLink
              href={`${APP_CONFIG.repositoryUrl.replace(/\/$/, "")}/releases`}
              className="inline-flex shrink-0 items-center gap-1.5 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("updates.releases")}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </ExternalLink>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={releaseNotes !== null}
        onOpenChange={(open) => {
          if (!open) setReleaseNotes(null);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          aria-describedby={undefined}
          className="flex min-h-0 flex-col overflow-hidden sm:max-w-3xl"
        >
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>
              {releaseNotes?.version
                ? t("updates.releaseNotesTitle", {
                    version: releaseNotes.version,
                  })
                : t("updates.releaseNotes")}
            </DialogTitle>
          </DialogHeader>
          {/* Radix 的测量层默认 display:table；正文宽度跟随视口，代码与表格各自滚动。 */}
          <ScrollArea className="min-h-0 min-w-0 [&>[data-slot=scroll-area-viewport]]:max-h-[60dvh] [&>[data-slot=scroll-area-viewport]>div]:block!">
            <div
              role="region"
              aria-label={t("updates.releaseNotes")}
              tabIndex={0}
              className="rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_h4]:font-semibold [&_p]:leading-relaxed [&_li]:leading-relaxed [&_a]:break-all"
            >
              {releaseNotes?.body?.trim() ? (
                <Suspense
                  fallback={
                    <p role="status" className="text-sm text-muted-foreground">
                      {t("common.loading")}
                    </p>
                  }
                >
                  <ReleaseNotesMarkdown content={releaseNotes.body} />
                </Suspense>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("updates.noReleaseNotes")}
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <Dialog
        open={
          confirmInstall !== null &&
          native &&
          confirmInstall === operationId &&
          phase === "ready"
        }
        onOpenChange={(open) => {
          if (!open) setConfirmInstall(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("updates.installConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("updates.installConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmInstall(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void install()}>
              {t("updates.install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={native && confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("updates.restart")}</DialogTitle>
            <DialogDescription>
              {t("updates.restartDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={restarting}
              onClick={() => setConfirmRestart(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={restarting} onClick={() => void restart()}>
              {t("updates.restart")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, RotateCcwIcon } from "lucide-react";
import { NativePage, ResourceError } from "@/components/native-page";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { APP_CONFIG } from "@/config/app";
import { useUpdates, checkUpdates, installUpdate } from "@/lib/updates-store";
import { relaunchApp } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
export default function Updates() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const { phase, operationId, status, progress, error } = useUpdates();
  const [confirmInstall, setConfirmInstall] = useState<number | null>(null);
  const installingRef = useRef(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const configured =
    status?.configured ?? Boolean(APP_CONFIG.updates.publicKey);
  const restartingRef = useRef(false);
  const mounted = useRef(false);
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
  async function install() {
    if (
      installingRef.current ||
      phase !== "ready" ||
      confirmInstall !== operationId
    )
      return;
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
    if (restartingRef.current) return;
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
    <NativePage
      title={t("updates.title")}
      description={t("updates.description")}
    >
      <ResourceError error={error} retry={() => void checkUpdates()} />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("updates.configuration")}
          </CardTitle>
          <CardDescription>
            {t("updates.configurationDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="break-all font-mono text-xs text-muted-foreground">
            {APP_CONFIG.updates.endpoint}
          </p>
          <Badge variant={configured ? "secondary" : "outline"}>
            {t(configured ? "updates.keyConfigured" : "updates.keyMissing")}
          </Badge>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void checkUpdates()}
              disabled={busy || phase === "installed"}
              data-testid="check-updates"
            >
              {t(phase === "checking" ? "updates.checking" : "updates.check")}
            </Button>
            {status ? (
              <span className="text-xs text-muted-foreground">
                {t("updates.current", { version: status.currentVersion })}
              </span>
            ) : null}
          </div>
          {status && !status.configured ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("updates.notConfigured")}
            </p>
          ) : status && !status.available && phase === "ready" ? (
            <p role="status" className="text-sm">
              {t("updates.latest")}
            </p>
          ) : null}
          {status?.available ? (
            <div className="space-y-3">
              <p className="font-medium">
                {t("updates.available", { version: status.version ?? "" })}
              </p>
              {status.body ? (
                <div>
                  <h3 className="mb-1 text-xs text-muted-foreground">
                    {t("updates.releaseNotes")}
                  </h3>
                  <p className="whitespace-pre-wrap text-sm">{status.body}</p>
                </div>
              ) : null}
              {phase !== "installed" ? (
                <Button
                  onClick={() => setConfirmInstall(operationId)}
                  disabled={busy}
                >
                  <DownloadIcon />
                  {t("updates.install")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {phase === "downloading" ? (
            <div role="status" className="space-y-2">
              <p className="text-xs">
                {t("updates.downloading", {
                  progress:
                    percent === undefined
                      ? `${Math.round((progress?.downloaded ?? 0) / 1024)} KB`
                      : `${percent}%`,
                })}
              </p>
              <Progress value={percent} aria-label={t("updates.install")} />
            </div>
          ) : null}
          {phase === "installing" ? (
            <p role="status">{t("updates.installing")}</p>
          ) : null}
          {phase === "installed" ? (
            <div role="status" className="space-y-3">
              <p>{t("updates.installed")}</p>
              <Button onClick={() => setConfirmRestart(true)}>
                <RotateCcwIcon />
                {t("updates.restart")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Dialog
        open={
          confirmInstall !== null &&
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
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
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
    </NativePage>
  );
}

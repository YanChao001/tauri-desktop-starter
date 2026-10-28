import { getLocale } from "@/i18n/registry";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { NativePage, ResourceError } from "@/components/native-page";
import { HelpTooltip } from "@/components/help-tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import { useNativeResource } from "@/hooks/use-native-resource";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { errorMessage, nativeErrorText } from "@/lib/native-error";
import { isRecord } from "@/lib/settings-model";
import { copyText } from "@/lib/clipboard";
import {
  recoveryStatus,
  listRecoveryBackups,
  pickRecoveryBackup,
  previewRecoveryBackup,
  restoreRecoveryBackup,
  stageRecovery,
  relaunchApp,
  getDiagnosticsReport,
  isTauri,
  type BackupPreview,
} from "@/lib/tauri";

function RecoveryRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("section", "recovery");
  return <Navigate to={`/diagnostics?${params.toString()}`} replace />;
}

export function RecoveryContent({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { t, language } = useI18n();
  const latest = useLatestTranslator();
  const load = useCallback(() => recoveryStatus(), []);
  const { data: status, error: statusError, reload } = useNativeResource(load);
  const loadBackups = useCallback(
    () => (status?.active ? listRecoveryBackups() : Promise.resolve(null)),
    [status?.active],
  );
  const {
    data: backups,
    error: backupsError,
    loading: backupsLoading,
    reload: reloadBackups,
  } = useNativeResource(loadBackups);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [recoveryError, setRecoveryError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [resetSettings, setResetSettings] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const notifiedStatusError = useRef<unknown>(null);
  const reportError = useCallback(
    (reason: unknown) => {
      setError(reason);
      if (isRecord(reason) && reason.code === "STORAGE_CORRUPT") {
        setRecoveryError(reason);
      }
      toast.error(nativeErrorText(reason, latest));
    },
    [latest],
  );
  useEffect(() => {
    if (!statusError) notifiedStatusError.current = null;
    else if (status && notifiedStatusError.current !== statusError) {
      notifiedStatusError.current = statusError;
      toast.error(nativeErrorText(statusError, latest));
    }
  }, [status, statusError, latest]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      if (mounted.current) reportError(reason);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (standalone && (!isTauri() || (status && !status.active)))
    return <RecoveryRedirect />;

  const content = (
    <>
      <ResourceError
        error={status ? null : statusError}
        retry={() => void reload()}
      />
      {status ? (
        <Card>
          <CardContent className="space-y-3">
            <h3 className="font-semibold">
              {t(status.active ? "recovery.isolated" : "recovery.healthy")}
            </h3>
            {status.active ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("recovery.preserved")}
                </p>
                <div
                  role="region"
                  tabIndex={0}
                  aria-label={t("recovery.isolated")}
                  className="h-36 overflow-y-auto rounded-lg border border-amber-500/40 p-3 text-sm break-words"
                >
                  <p role="alert">{status.reason}</p>
                  {recoveryError ? (
                    <div className="mt-3 space-y-1 border-t pt-3 text-destructive">
                      <p role="alert">{nativeErrorText(recoveryError, t)}</p>
                      {isRecord(recoveryError) &&
                      typeof recoveryError.message === "string" ? (
                        <p className="whitespace-pre-wrap">
                          {errorMessage(recoveryError)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("recovery.noAction")}
              </p>
            )}
            {status.archiveId ? (
              <p
                className="max-h-24 overflow-y-auto text-sm break-all"
                tabIndex={0}
              >
                {t("recovery.archive", { id: status.archiveId })}
              </p>
            ) : null}
            {status.active ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await copyText(
                      JSON.stringify(await getDiagnosticsReport(), null, 2),
                    );
                    if (mounted.current)
                      toast.success(latest("recovery.copied"));
                  })
                }
              >
                {t("recovery.diagnostics")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {status?.active ? (
        <>
          <Card>
            <CardContent className="space-y-3">
              <h3 className="flex items-center gap-2 font-semibold">
                {t("recovery.choose")}
                <HelpTooltip
                  label={`${t("recovery.choose")} · ${t("title.help")}`}
                >
                  {t("recovery.chooseHint")}
                </HelpTooltip>
              </h3>
              <Button
                disabled={busy || status.pending}
                onClick={() =>
                  void run(async () => {
                    const value = await pickRecoveryBackup();
                    if (mounted.current && value) {
                      setPreview(value);
                      setRecoveryError(null);
                    }
                  })
                }
              >
                {t("recovery.import")}
              </Button>
              <div
                className="min-h-20 space-y-2"
                role="region"
                aria-label={t("recovery.backups")}
                aria-busy={backupsLoading || (!backups && !backupsError)}
              >
                <ResourceError
                  error={backupsError}
                  retry={() => void reloadBackups()}
                />
                {!backups && !backupsError ? (
                  <p
                    role="status"
                    className="py-3 text-sm text-muted-foreground"
                  >
                    {t("recovery.backupsLoading")}
                  </p>
                ) : backups?.length ? (
                  <ul className="max-h-72 space-y-2 overflow-y-auto">
                    {backups.map((backup) => (
                      <li
                        key={backup.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"
                      >
                        <div className="min-w-0 text-sm">
                          <p>
                            {new Date(backup.createdAt).toLocaleString(
                              getLocale(language).documentLang,
                            )}
                          </p>
                          <p className="text-xs break-all text-muted-foreground">
                            {backup.id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("data.backupCount", {
                              notes: backup.notes,
                              trashed: backup.trashed,
                              drafts: backup.drafts,
                            })}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || status.pending}
                          onClick={() =>
                            void run(async () => {
                              const value = await previewRecoveryBackup(
                                backup.id,
                              );
                              if (mounted.current) {
                                setPreview(value);
                                setRecoveryError(null);
                              }
                            })
                          }
                        >
                          {t("recovery.preview")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : backups && !backupsError ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    {t("recovery.backupsEmpty")}
                  </p>
                ) : null}
                {backupsLoading && backups ? (
                  <p role="status" className="sr-only">
                    {t("recovery.backupsLoading")}
                  </p>
                ) : null}
              </div>
              {preview ? (
                <section
                  className="space-y-3 rounded-lg border p-3"
                  aria-label={t("recovery.preview")}
                >
                  <p className="text-sm break-all">{preview.info.id}</p>
                  <p className="text-sm">
                    {t("data.backupCount", {
                      notes: preview.info.notes,
                      trashed: preview.info.trashed,
                      drafts: preview.info.drafts,
                    })}
                  </p>
                  <ul
                    tabIndex={0}
                    aria-label={t("recovery.preview")}
                    className="max-h-40 list-inside list-disc overflow-y-auto text-sm break-words"
                  >
                    {preview.sampleTitles.map((title, index) => (
                      <li key={index}>{title}</li>
                    ))}
                  </ul>
                  <Button
                    disabled={busy || status.pending}
                    onClick={() =>
                      void run(async () => {
                        await restoreRecoveryBackup(preview.info.id);
                        await reload();
                        if (mounted.current) {
                          setRecoveryError(null);
                          toast.success(latest("recovery.validated"));
                        }
                      })
                    }
                  >
                    {t("recovery.testRestore")}
                  </Button>
                </section>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3">
              <div className="flex min-h-6 min-w-0 items-center gap-3">
                <h3 className="flex shrink-0 items-center gap-2 font-semibold">
                  {t("recovery.schedule")}
                  <HelpTooltip
                    label={`${t("recovery.schedule")} · ${t("title.help")}`}
                  >
                    {t("recovery.scheduleHint")}
                  </HelpTooltip>
                </h3>
                <p
                  role="status"
                  tabIndex={status.restored || status.pending ? 0 : undefined}
                  className="h-5 min-w-0 flex-1 overflow-auto text-sm"
                >
                  {[
                    status.restored
                      ? t("recovery.recordCount", { count: status.notes })
                      : null,
                    status.pending ? t("recovery.pending") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  className="mt-1"
                  checked={resetSettings}
                  disabled={busy || status.pending}
                  onCheckedChange={(checked) =>
                    setResetSettings(checked === true)
                  }
                />
                <span>{t("recovery.resetSettings")}</span>
              </label>
              {status.pending ? (
                <Button
                  disabled={busy}
                  onClick={() => void run(() => relaunchApp())}
                >
                  {t("recovery.restart")}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={busy || !status.restored}
                  onClick={() => setConfirm(true)}
                >
                  {t("recovery.schedule")}
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      {error && error !== recoveryError && !confirm ? (
        <p role="alert" className="sr-only">
          {nativeErrorText(error, t)}
        </p>
      ) : null}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("recovery.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t(
                resetSettings
                  ? "recovery.confirmWithSettings"
                  : "recovery.confirmDatabase",
              )}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="sr-only">
              {nativeErrorText(error, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await stageRecovery(resetSettings);
                  await reload();
                  if (mounted.current) {
                    setRecoveryError(null);
                    setConfirm(false);
                  }
                })
              }
            >
              {t("recovery.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  return standalone ? (
    <NativePage
      title={t("diagnostics.title")}
      description={t("diagnostics.description")}
    >
      {content}
    </NativePage>
  ) : (
    content
  );
}

export default function Recovery() {
  return <RecoveryContent standalone />;
}

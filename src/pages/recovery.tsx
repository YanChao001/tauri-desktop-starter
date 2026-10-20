import { useCallback, useEffect, useRef, useState } from "react";
import { NativePage, ResourceError } from "@/components/native-page";
import { Button } from "@/components/ui/button";
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
import { nativeErrorText } from "@/lib/native-error";
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
  type BackupInfo,
  type BackupPreview,
} from "@/lib/tauri";

export default function Recovery() {
  const { t, language } = useI18n();
  const load = useCallback(() => recoveryStatus(), []);
  const { data: status, error: statusError, reload } = useNativeResource(load);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSettings, setResetSettings] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!status?.active) return;
    let stopped = false;
    void listRecoveryBackups()
      .then((items) => {
        if (!stopped) setBackups(items);
      })
      .catch((reason) => {
        if (!stopped) setError(reason);
      });
    return () => {
      stopped = true;
    };
  }, [status?.active]);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      if (mounted.current) setError(reason);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <NativePage
      title={t("recovery.title")}
      description={t("recovery.description")}
    >
      <ResourceError error={statusError} retry={() => void reload()} />
      {status ? (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <h3 className="font-semibold">
              {t(status.active ? "recovery.isolated" : "recovery.healthy")}
            </h3>
            {status.active ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("recovery.preserved")}
                </p>
                <p
                  role="alert"
                  className="rounded-lg border border-amber-500/40 p-3 text-sm"
                >
                  {status.reason}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("recovery.noAction")}
              </p>
            )}
            {status.archiveId ? (
              <p className="break-words text-sm">
                {t("recovery.archive", { id: status.archiveId })}
              </p>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await copyText(
                    JSON.stringify(await getDiagnosticsReport(), null, 2),
                  );
                  if (mounted.current) setNotice(t("recovery.copied"));
                })
              }
            >
              {t("recovery.diagnostics")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {status?.active ? (
        <>
          <Card>
            <CardContent className="space-y-4 pt-5">
              <h3 className="font-semibold">{t("recovery.choose")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("recovery.chooseHint")}
              </p>
              <Button
                disabled={busy || status.pending}
                onClick={() =>
                  void run(async () => {
                    const value = await pickRecoveryBackup();
                    if (mounted.current && value) setPreview(value);
                  })
                }
              >
                {t("recovery.import")}
              </Button>
              <ul className="space-y-2">
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"
                  >
                    <div className="text-sm">
                      <p>
                        {new Date(backup.createdAt).toLocaleString(
                          language === "zh" ? "zh-CN" : "en",
                        )}
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
                          const value = await previewRecoveryBackup(backup.id);
                          if (mounted.current) setPreview(value);
                        })
                      }
                    >
                      {t("recovery.preview")}
                    </Button>
                  </li>
                ))}
              </ul>
              {preview ? (
                <section
                  className="space-y-3 rounded-lg border p-3"
                  aria-label={t("recovery.preview")}
                >
                  <p className="text-sm">
                    {t("data.backupCount", {
                      notes: preview.info.notes,
                      trashed: preview.info.trashed,
                      drafts: preview.info.drafts,
                    })}
                  </p>
                  <ul className="list-inside list-disc text-sm">
                    {preview.sampleTitles.map((title, index) => (
                      <li key={index} className="truncate">
                        {title}
                      </li>
                    ))}
                  </ul>
                  <Button
                    disabled={busy || status.pending}
                    onClick={() =>
                      void run(async () => {
                        await restoreRecoveryBackup(preview.info.id);
                        await reload();
                        if (mounted.current) setNotice(t("recovery.validated"));
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
            <CardContent className="space-y-4 pt-5">
              <h3 className="font-semibold">{t("recovery.schedule")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("recovery.scheduleHint")}
              </p>
              {status.restored ? (
                <p role="status" className="text-sm">
                  {t("recovery.recordCount", { count: status.notes })}
                </p>
              ) : null}
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={resetSettings}
                  disabled={busy || status.pending}
                  onChange={(event) => setResetSettings(event.target.checked)}
                />
                <span>{t("recovery.resetSettings")}</span>
              </label>
              {status.pending ? (
                <>
                  <p role="status" className="text-sm">
                    {t("recovery.pending")}
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => relaunchApp())}
                  >
                    {t("recovery.restart")}
                  </Button>
                </>
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
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {nativeErrorText(error, t)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
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
            <p role="alert" className="text-sm text-destructive">
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
                  if (mounted.current) setConfirm(false);
                })
              }
            >
              {t("recovery.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NativePage>
  );
}

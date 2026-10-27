import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import {
  createDataBackup,
  listDataBackups,
  previewDataBackup,
  restoreDataBackup,
  pickDataBackup,
  saveDataBackup,
  type BackupInfo,
  type BackupPreview,
} from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { useLatestTranslator } from "@/hooks/use-latest-translator";

type Props = {
  dirty: boolean;
  pending: boolean;
  flushDraft: () => Promise<void>;
  afterRestore: () => Promise<void>;
  lockEditor: (locked: boolean) => void;
};

export function BackupPanel({
  dirty,
  pending,
  flushDraft,
  afterRestore,
  lockEditor,
}: Props) {
  const { t, language } = useI18n();
  const latest = useLatestTranslator();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const focusAfterBusy = useRef(false);
  useEffect(() => {
    if (!busy && focusAfterBusy.current) {
      focusAfterBusy.current = false;
      returnFocus.current?.focus();
    }
  }, [busy]);
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
    try {
      await action();
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function restore() {
    if (!preview || dirty || pending) return;
    lockEditor(true);
    try {
      await flushDraft();
      const result = await restoreDataBackup(preview.info.id);
      if (mounted.current) {
        setPreview(null);
        setBackupsOpen(false);
      }
      await afterRestore();
      if (mounted.current) {
        setBackups(await listDataBackups());
        toast.success(latest("data.restored", { count: result.restored }));
      }
    } finally {
      lockEditor(false);
    }
  }
  return (
    <TooltipProvider delayDuration={650} skipDelayDuration={0}>
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("data.backups")}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              aria-label={`${t("data.backupAction")} · ${t("data.createBackup")}`}
              disabled={busy || pending}
              onClick={() =>
                void run(async () => {
                  await flushDraft();
                  const info = await createDataBackup();
                  const items = await listDataBackups();
                  if (mounted.current) {
                    setBackups(items);
                    toast.success(
                      latest("data.backupCreated", {
                        count: info.notes + info.trashed,
                      }),
                    );
                  }
                })
              }
            >
              {t("data.backupAction")}
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            collisionPadding={8}
            className="max-w-[min(20rem,var(--radix-tooltip-content-available-width))] whitespace-normal break-words leading-relaxed"
          >
            {t("data.backupHint")}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              aria-label={`${t("data.importBackupAction")} · ${t("data.importBackup")}`}
              disabled={busy}
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                void run(async () => {
                  const value = await pickDataBackup();
                  if (value && mounted.current) {
                    setPreview(value);
                    setBackups(await listDataBackups());
                  }
                });
              }}
            >
              {t("data.importBackupAction")}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8}>
            {t("data.importBackup")}
          </TooltipContent>
        </Tooltip>
        <Dialog
          open={backupsOpen || preview !== null}
          onOpenChange={(open) => {
            if (!busy) {
              setBackupsOpen(open);
              if (!open) setPreview(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              aria-label={`${t("data.backupHistory")} · ${t("data.backups")}`}
              disabled={busy}
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                void run(async () => {
                  const items = await listDataBackups();
                  if (mounted.current) setBackups(items);
                });
              }}
            >
              {t("data.backupHistory")}
            </Button>
          </DialogTrigger>
          <DialogContent
            closeLabel={t("common.close")}
            className="sm:max-w-xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (busy) focusAfterBusy.current = true;
              else returnFocus.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t(preview ? "data.previewBackup" : "data.backups")}
              </DialogTitle>
              <DialogDescription>
                {t(preview ? "data.restoreHint" : "data.backupHint")}
              </DialogDescription>
            </DialogHeader>
            {preview ? (
              <>
                <p className="text-sm">
                  {t("data.backupCount", {
                    notes: preview.info.notes,
                    trashed: preview.info.trashed,
                    drafts: preview.info.drafts,
                  })}
                </p>
                <ul className="list-inside list-disc text-sm">
                  {preview.sampleTitles.map((title, index) => (
                    <li key={index} className="break-words">
                      {title}
                    </li>
                  ))}
                </ul>
                {dirty ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t("data.saveBeforeRestore")}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPreview(null);
                      setBackupsOpen(false);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || pending || dirty}
                    onClick={() => void run(restore)}
                  >
                    {t("data.restoreBackup")}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <ul className="space-y-2" aria-busy={busy}>
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"
                  >
                    <div>
                      <p className="text-sm">
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const value = await previewDataBackup(backup.id);
                            if (mounted.current) setPreview(value);
                          })
                        }
                      >
                        {t("data.previewBackup")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (
                              (await saveDataBackup(backup.id)) &&
                              mounted.current
                            )
                              toast.success(latest("data.exported"));
                          })
                        }
                      >
                        {t("data.exportBackup")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

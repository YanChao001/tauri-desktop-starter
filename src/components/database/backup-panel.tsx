import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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

type Props = {
  dirty: boolean;
  pending: boolean;
  beforeBackup: () => Promise<void>;
  afterRestore: () => Promise<void>;
  lockEditor: (locked: boolean) => void;
};

export function BackupPanel({
  dirty,
  pending,
  beforeBackup,
  afterRestore,
  lockEditor,
}: Props) {
  const { t, language } = useI18n();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const mounted = useRef(false);
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
    setNotice("");
    try {
      await action();
    } catch (reason) {
      if (mounted.current) setError(reason);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function restore() {
    if (!preview || dirty || pending) return;
    lockEditor(true);
    try {
      const result = await restoreDataBackup(preview.info.id);
      await afterRestore();
      if (mounted.current) {
        setBackups(await listDataBackups());
        setPreview(null);
        setNotice(t("data.restored", { count: result.restored }));
      }
    } finally {
      lockEditor(false);
    }
  }
  return (
    <>
      <details
        className="rounded-xl border bg-card p-4"
        onToggle={(event) => {
          if (event.currentTarget.open)
            void run(async () => {
              const items = await listDataBackups();
              if (mounted.current) setBackups(items);
            });
        }}
      >
        <summary className="cursor-pointer font-medium">
          {t("data.backups")}
        </summary>
        <p className="my-3 text-sm text-muted-foreground">
          {t("data.backupHint")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || pending}
            onClick={() =>
              void run(async () => {
                await beforeBackup();
                const info = await createDataBackup();
                const items = await listDataBackups();
                if (mounted.current) {
                  setBackups(items);
                  setNotice(
                    t("data.backupCreated", {
                      count: info.notes + info.trashed,
                    }),
                  );
                }
              })
            }
          >
            {t("data.createBackup")}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const value = await pickDataBackup();
                if (value && mounted.current) {
                  setPreview(value);
                  setBackups(await listDataBackups());
                }
              })
            }
          >
            {t("data.importBackup")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {nativeErrorText(error, t)}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-3 text-sm">
            {notice}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
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
              <div className="flex gap-2">
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
                      if ((await saveDataBackup(backup.id)) && mounted.current)
                        setNotice(t("data.exported"));
                    })
                  }
                >
                  {t("data.exportBackup")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("data.previewBackup")}</DialogTitle>
            <DialogDescription>{t("data.restoreHint")}</DialogDescription>
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
                  <li key={index} className="truncate">
                    {title}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {dirty ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("data.saveBeforeRestore")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(error, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
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
        </DialogContent>
      </Dialog>
    </>
  );
}

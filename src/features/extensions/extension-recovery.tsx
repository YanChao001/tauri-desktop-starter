import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import { nativeErrorText } from "@/lib/native-error";
import { isRecord } from "@/lib/settings-model";
import { archiveLegacyExtensions, previewExtensionArchive } from "@/lib/tauri";

type ArchivePreview = Awaited<ReturnType<typeof previewExtensionArchive>>;

const STATUS_MESSAGES = {
  current: "ext.recovery.current",
  future: "ext.recovery.future",
  invalid: "ext.recovery.invalid",
  unavailable: "ext.recovery.unavailable",
} as const;

/** Keep the archive receipt visible even after reloading clears the original error. */
export function ExtensionRecovery({
  error,
  reload,
}: {
  error: unknown;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const code = isRecord(error) ? error.code : null;
  const applicable =
    code === "EXTENSION_INCOMPATIBLE" || code === "STORAGE_CORRUPT";
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const lifecycle = useRef({ epoch: 0, request: 0 });
  const locked = useRef(false);
  const checkButton = useRef<HTMLButtonElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const receipt = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const state = lifecycle.current;
    const current = ++state.epoch;
    return () => {
      if (state.epoch === current) state.epoch++;
      state.request++;
    };
  }, []);

  const inspect = useCallback(async () => {
    if (locked.current) return;
    const current = lifecycle.current.epoch;
    const pending = ++lifecycle.current.request;
    setChecking(true);
    setPreview(null);
    setFailure(null);
    try {
      const next = await previewExtensionArchive();
      if (
        lifecycle.current.epoch === current &&
        lifecycle.current.request === pending
      )
        setPreview(next);
    } catch (reason) {
      if (
        lifecycle.current.epoch === current &&
        lifecycle.current.request === pending
      ) {
        setFailure(reason);
        toast.error(nativeErrorText(reason, latest));
      }
    } finally {
      if (
        lifecycle.current.epoch === current &&
        lifecycle.current.request === pending
      )
        setChecking(false);
    }
  }, [latest]);

  useEffect(() => {
    if (applicable && !archivePath) void inspect();
    else if (!locked.current) {
      lifecycle.current.request++;
      setChecking(false);
      setPreview(null);
      if (!archivePath) setFailure(null);
      setConfirm(false);
    }
  }, [applicable, code, archivePath, inspect]);

  async function archive() {
    if (locked.current || preview?.status !== "legacy" || !preview.fingerprint)
      return;
    const current = lifecycle.current.epoch;
    const expected = preview.fingerprint;
    locked.current = true;
    lifecycle.current.request++;
    setArchiving(true);
    setFailure(null);
    try {
      const result = await archiveLegacyExtensions(expected);
      if (lifecycle.current.epoch !== current) return;
      setArchivePath(result.archivePath);
      setPreview(null);
      setConfirm(false);
      setReloading(true);
      // The provider reports initialization failures separately. A successful
      // rename is a receipt for the archive, not proof that initialization worked.
      await reload();
    } catch (reason) {
      if (lifecycle.current.epoch !== current) return;
      setFailure(reason);
      toast.error(nativeErrorText(reason, latest));
      setPreview(null);
      setConfirm(false);
    } finally {
      locked.current = false;
      if (lifecycle.current.epoch === current) {
        setArchiving(false);
        setReloading(false);
      }
    }
  }

  async function retryInitialization() {
    if (locked.current || !archivePath) return;
    const current = lifecycle.current.epoch;
    locked.current = true;
    setReloading(true);
    setFailure(null);
    try {
      await reload();
    } catch (reason) {
      if (lifecycle.current.epoch !== current) return;
      setFailure(reason);
      toast.error(nativeErrorText(reason, latest));
    } finally {
      locked.current = false;
      if (lifecycle.current.epoch === current) setReloading(false);
    }
  }

  if (!applicable && !archivePath) return null;

  const busy = checking || archiving || reloading;
  const failureText = failure ? nativeErrorText(failure, t) : "";
  const failureDetail =
    isRecord(failure) &&
    typeof failure.message === "string" &&
    !failureText.includes(failure.message)
      ? failure.message
      : null;
  const failureMessage = failure ? (
    <div
      role="alert"
      className="space-y-1 whitespace-pre-wrap break-words text-sm text-destructive"
    >
      <p>{failureText}</p>
      {failureDetail ? <p>{failureDetail}</p> : null}
    </div>
  ) : null;
  return (
    <section
      aria-label={t("ext.recovery.title")}
      className="min-w-0 space-y-3 rounded-xl border app-surface p-4"
    >
      <h3 className="flex items-center gap-2 font-semibold">
        {t("ext.recovery.title")}
        <HelpTooltip label={`${t("ext.recovery.title")} · ${t("title.help")}`}>
          {t("ext.recovery.checkHint")}
        </HelpTooltip>
      </h3>
      {archivePath ? (
        <div ref={receipt} tabIndex={-1} className="space-y-2 outline-none">
          <p role="status">{t("ext.recovery.archived")}</p>
          <p className="text-sm text-muted-foreground">
            {t("ext.recovery.archiveLocation")}
          </p>
          <p
            aria-label={t("ext.recovery.archiveLocation")}
            tabIndex={0}
            data-surface="reading"
            className="max-h-24 overflow-auto break-all rounded-md p-3 font-mono text-xs select-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {archivePath}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("ext.recovery.afterArchive")}
            <span role="status" className="ml-2">
              {reloading ? t("common.loading") : ""}
            </span>
          </p>
          {failure ? (
            <div
              tabIndex={0}
              className="h-24 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {failureMessage}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void retryInitialization()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            tabIndex={0}
            className="h-24 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {checking ? (
              <p role="status">{t("ext.recovery.checking")}</p>
            ) : failure ? (
              failureMessage
            ) : preview?.status === "legacy" && preview.fingerprint ? (
              <p className="text-sm text-muted-foreground">
                {t("ext.recovery.legacy", { count: preview.installedCount })}
              </p>
            ) : preview ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  preview.status === "legacy"
                    ? "ext.recovery.invalid"
                    : STATUS_MESSAGES[preview.status],
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("ext.recovery.checkHint")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={checkButton}
              variant="outline"
              disabled={busy}
              onClick={() => void inspect()}
            >
              {t("ext.recovery.checkAgain")}
            </Button>
            <Dialog
              open={confirm}
              onOpenChange={(open) => {
                if (!archiving) setConfirm(open);
              }}
            >
              {preview?.status === "legacy" && preview.fingerprint ? (
                <DialogTrigger asChild>
                  <Button ref={archiveButton} disabled={busy}>
                    {t("ext.recovery.archive")}
                  </Button>
                </DialogTrigger>
              ) : null}
              <DialogContent
                closeLabel={t("common.close")}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  const target =
                    receipt.current ??
                    archiveButton.current ??
                    checkButton.current;
                  if (target && !target.matches(":disabled")) target.focus();
                }}
              >
                <DialogHeader>
                  <DialogTitle>{t("ext.recovery.confirmTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("ext.recovery.confirmHint")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={archiving}
                    onClick={() => setConfirm(false)}
                  >
                    {t("ext.cancel")}
                  </Button>
                  <Button
                    className="min-w-40"
                    disabled={archiving}
                    onClick={() => void archive()}
                  >
                    {t(
                      archiving
                        ? "ext.recovery.archiving"
                        : "ext.recovery.confirm",
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nativeErrorText } from "@/lib/native-error";
import { useI18n } from "@/providers/i18n";

export function ExtensionSessionClose({
  dirty,
  busy,
  disabled,
  onSave,
  onClose,
}: {
  dirty: boolean;
  busy: boolean;
  disabled: boolean;
  onSave: (signal: AbortSignal) => Promise<void>;
  onClose: (signal: AbortSignal) => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const operation = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (open || disabled || working || !restoreFocus.current) return;
    if (document.activeElement === document.body) trigger.current?.focus();
    restoreFocus.current = false;
  }, [open, disabled, working]);

  function dismiss() {
    operation.current?.abort();
    setOpen(false);
    setError(null);
  }
  async function finish(exportFirst: boolean) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setWorking(true);
    setError(null);
    try {
      if (exportFirst) await onSave(controller.signal);
      controller.signal.throwIfAborted();
      await onClose(controller.signal);
      if (!controller.signal.aborted) setOpen(false);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason);
        setOpen(true);
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (alive.current) setWorking(false);
    }
  }
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        size="sm"
        disabled={disabled || working}
        title={t("ext.appCloseHint")}
        onClick={() => {
          if (dirty || busy) setOpen(true);
          else void finish(false);
        }}
      >
        {t("ext.appClose")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus.current = true;
            if (trigger.current && !trigger.current.disabled) {
              trigger.current.focus();
              restoreFocus.current = false;
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("ext.appCloseTitle")}</DialogTitle>
            <DialogDescription>
              {t("ext.appCloseDescription")}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(error, t)}
            </p>
          ) : null}
          <DialogFooter className="sm:flex-wrap">
            <Button variant="outline" onClick={dismiss}>
              {t("ext.cancel")}
            </Button>
            <Button
              variant="outline"
              disabled={disabled || working}
              onClick={() => void finish(false)}
            >
              {t("ext.appDiscardClose")}
            </Button>
            <Button
              disabled={disabled || working}
              onClick={() => void finish(true)}
            >
              {t("ext.appSaveClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

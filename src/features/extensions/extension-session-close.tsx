import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import { useExtensionActivity } from "./extension-activity";

export type ExtensionSessionCloseHandle = {
  requestClose: () => void;
};

export function ExtensionSessionClose({
  dirty,
  busy,
  disabled,
  onSave,
  onClose,
  ref,
  returnFocusRef,
}: {
  dirty: boolean;
  busy: boolean;
  disabled: boolean;
  onSave: (signal: AbortSignal) => Promise<void>;
  onClose: (signal: AbortSignal) => Promise<void>;
  ref?: Ref<ExtensionSessionCloseHandle>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const active = useExtensionActivity();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const operation = useRef<AbortController | null>(null);
  const restoreFocus = useRef(false);
  const alive = useRef(false);
  const focusTrigger = useCallback(() => {
    if (!active) return false;
    const target = returnFocusRef.current;
    if (target?.disabled) return false;
    target?.focus();
    return Boolean(target);
  }, [active, returnFocusRef]);
  useImperativeHandle(ref, () => ({ requestClose }));
  useEffect(() => {
    if (!active) {
      operation.current?.abort();
      setOpen(false);
      setError(null);
      restoreFocus.current = false;
    }
  }, [active]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (open || disabled || working || !restoreFocus.current) return;
    if (document.activeElement === document.body) focusTrigger();
    restoreFocus.current = false;
  }, [open, disabled, working, focusTrigger]);

  function requestClose() {
    if (!active || disabled || working || operation.current) return;
    if (dirty || busy) setOpen(true);
    else void finish(false);
  }
  function dismiss() {
    operation.current?.abort();
    setOpen(false);
    setError(null);
  }
  async function finish(exportFirst: boolean) {
    if (disabled || operation.current) return;
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
        toast.error(nativeErrorText(reason, t), {
          id: "extension-session-close",
        });
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (alive.current) setWorking(false);
    }
  }
  return (
    <Dialog
      open={active && open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus.current = !focusTrigger();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("ext.appCloseTitle")}</DialogTitle>
          <DialogDescription>{t("ext.appCloseDescription")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="sr-only">
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
  );
}

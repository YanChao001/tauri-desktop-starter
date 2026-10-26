import {
  UnsavedWorkContext as Context,
  type UnsavedWork,
} from "./unsaved-work-context";
export type { UnsavedWork } from "./unsaved-work-context";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import {
  isTauri,
  onLifecycleRequest,
  onLifecycleFinished,
  onLifecycleExecuting,
  respondLifecycle,
  setWindowWorkState,
  type LifecycleRequest,
} from "@/lib/tauri";

/** 脏工作在离页后仍保留最后一个保存动作，保存成功或明确放弃后移除。 */
export function useUnsavedWork(work: UnsavedWork) {
  const registry = useContext(Context);
  useEffect(() => {
    registry?.register(work);
  });
  useEffect(() => () => registry?.unregister(work.id), [registry, work.id]);
}

export function UnsavedWorkProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const items = useRef(new Map<string, UnsavedWork>());
  const operation = useRef<AbortController | null>(null);
  const requestId = useRef<number | null>(null);
  const completedThrough = useRef(0);
  const [revision, setRevision] = useState(0);
  const [request, setRequest] = useState<LifecycleRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [listening, setListening] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const errorToastId = useId();
  const notifiedError = useRef<string | null>(null);
  const register = useCallback((work: UnsavedWork) => {
    const previous = items.current.get(work.id);
    items.current.set(work.id, work);
    if (
      (!previous && work.dirty) ||
      previous?.dirty !== work.dirty ||
      (work.dirty && previous?.label !== work.label)
    )
      setRevision((v) => v + 1);
  }, []);
  const unregister = useCallback((id: string) => {
    if (!items.current.get(id)?.dirty) items.current.delete(id);
  }, []);
  const registry = useMemo(
    () => ({ register, unregister }),
    [register, unregister],
  );
  useEffect(() => {
    if (isTauri() && listening)
      void setWindowWorkState(
        [...items.current.values()].filter((v) => v.dirty).map((v) => v.label),
      ).catch((reason: unknown) => setError(String(reason)));
  }, [revision, listening]);
  useEffect(() => {
    let stopped = false;
    const stops: (() => void)[] = [];
    const attach = (promise: Promise<() => void>) =>
      promise.then((stop) => {
        if (stopped) stop();
        else stops.push(stop);
      });
    const requests = attach(
      onLifecycleRequest((value) => {
        if (
          stopped ||
          value.id <= completedThrough.current ||
          (requestId.current !== null && value.id <= requestId.current)
        )
          return;
        operation.current?.abort();
        operation.current = null;
        requestId.current = value.id;
        setBusy(false);
        setExecuting(false);
        setError(null);
        setWaiting(false);
        setRequest(value);
      }),
    );
    const finished = attach(
      onLifecycleFinished((id) => {
        if (stopped) return;
        completedThrough.current = Math.max(completedThrough.current, id);
        setRequest((current) => (current?.id === id ? null : current));
        if (requestId.current === id) {
          operation.current?.abort();
          operation.current = null;
          requestId.current = null;
          setBusy(false);
          setRequest(null);
          setWaiting(false);
          setExecuting(false);
        }
      }),
    );
    const execution = attach(
      onLifecycleExecuting((id) => {
        if (!stopped && requestId.current === id) setExecuting(true);
      }),
    );
    void Promise.all([requests, finished, execution])
      .then(() => {
        if (!stopped) {
          setListening(true);
        }
      })
      .catch((reason: unknown) => {
        if (!stopped) setError(String(reason));
      });
    const warn = (event: BeforeUnloadEvent) => {
      if ([...items.current.values()].some((v) => v.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      stopped = true;
      operation.current?.abort();
      stops.forEach((stop) => stop());
      window.removeEventListener("beforeunload", warn);
    };
  }, [attempt]);
  const answer = useCallback(
    async (choice: "save" | "discard" | "cancel") => {
      if (!request || executing || ((busy || waiting) && choice !== "cancel"))
        return;
      const id = request.id;
      if (choice === "cancel") {
        operation.current?.abort();
        operation.current = null;
        try {
          await respondLifecycle(id, false);
          if (requestId.current === id) {
            requestId.current = null;
            setRequest(null);
            setWaiting(false);
            setBusy(false);
          }
        } catch (reason) {
          if (requestId.current === id) setError(String(reason));
        }
        return;
      }
      const controller = new AbortController();
      operation.current = controller;
      setBusy(true);
      setError(null);
      try {
        for (const work of [...items.current.values()].filter((v) => v.dirty)) {
          if (choice === "save") await work.save(controller.signal);
          else await work.discard(controller.signal);
          controller.signal.throwIfAborted();
          items.current.delete(work.id);
        }
        setRevision((v) => v + 1);
        controller.signal.throwIfAborted();
        await respondLifecycle(id, true);
        if (requestId.current === id) setWaiting(true);
      } catch (reason) {
        if (!controller.signal.aborted && requestId.current === id)
          setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (operation.current === controller) {
          operation.current = null;
          setBusy(false);
        }
      }
    },
    [request, busy, waiting, executing],
  );
  useEffect(() => {
    if (
      request &&
      !busy &&
      !waiting &&
      !error &&
      ![...items.current.values()].some((work) => work.dirty)
    )
      void answer("save");
  }, [request, revision, busy, waiting, error, answer]);
  useEffect(() => {
    if (!error || request) {
      notifiedError.current = null;
      toast.dismiss(errorToastId);
      return;
    }
    if (notifiedError.current === error) return;
    notifiedError.current = error;
    toast.error(error, {
      id: errorToastId,
      duration: Infinity,
      action: {
        label: t("common.retry"),
        onClick: () => {
          setError(null);
          setListening(false);
          setAttempt((value) => value + 1);
        },
      },
    });
  }, [error, request, errorToastId, t]);
  useEffect(
    () => () => {
      toast.dismiss(errorToastId);
    },
    [errorToastId],
  );
  return (
    <Context.Provider value={registry}>
      {children}
      <Dialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) void answer("cancel");
        }}
      >
        <DialogContent
          className="min-w-0 sm:max-w-xl"
          data-lifecycle-request={request?.id}
          data-lifecycle-phase={
            executing
              ? "executing"
              : waiting
                ? "waiting"
                : busy
                  ? "saving"
                  : "prompt"
          }
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("lifecycle.title")}</DialogTitle>
            <DialogDescription>
              {t("lifecycle.description", {
                count: request?.windows.length ?? 1,
              })}
            </DialogDescription>
          </DialogHeader>
          <ul className="list-inside list-disc text-sm">
            {[...items.current.values()]
              .filter((v) => v.dirty)
              .map((v) => (
                <li key={v.id}>{v.label}</li>
              ))}
          </ul>
          <div
            className="h-16 overflow-y-auto text-sm"
            tabIndex={error ? 0 : undefined}
            data-lifecycle-status
          >
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : busy || waiting || executing ? (
              <p role="status">
                {t(
                  executing
                    ? "lifecycle.executing"
                    : waiting
                      ? "lifecycle.waiting"
                      : "lifecycle.saving",
                )}
              </p>
            ) : null}
          </div>
          <DialogFooter className="sm:flex-wrap [&>button]:whitespace-normal">
            <Button
              variant="outline"
              disabled={executing}
              onClick={() => void answer("cancel")}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || waiting}
              onClick={() => void answer("discard")}
            >
              {t("lifecycle.discard")}
            </Button>
            <Button
              disabled={busy || waiting}
              onClick={() => void answer("save")}
            >
              {busy ? t("lifecycle.saving") : t("lifecycle.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { useUnsavedWork } from "@/providers/unsaved-work";
import { nativeErrorText } from "@/lib/native-error";
import {
  cancelExtension,
  viewExtension,
  saveTextExport,
  NativeBridgeError,
  type ExtensionInfo,
  type ExtensionView,
  type ExtensionViewDataInput,
} from "@/lib/tauri";
import {
  ExtensionView as ViewRenderer,
  EXTENSION_FIELD_BYTES,
} from "./extension-view";
import { ExtensionData } from "./extension-data";
import { useExtensionSession } from "./extensions-provider";
import { LOCKED_CONTROL_CLASS } from "./control-styles";

/** The renderer has no calculator/game rules. Every action runs the declared Wasm export. */
export function ExtensionApp({
  item,
  commandId,
  runningId,
  onClose,
  onSettled,
}: {
  item: ExtensionInfo;
  commandId: string;
  runningId: string | null;
  onClose: () => void;
  onSettled: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const manifest = item.package.manifest;
  const workId = `extension-app:${manifest.id}:${commandId}:${item.package.sha256}:${manifest.version}`;
  const session = useExtensionSession(
    `${manifest.id}:${commandId}`,
    `${item.package.sha256}:${manifest.version}`,
  );
  const [view, setView] = useState<ExtensionView | null>(session.view);
  const latest = useRef<ExtensionView | null>(session.view);
  const [fields, setFields] = useState<Record<string, string>>(session.fields);
  const latestFields = useRef(fields);
  const [busy, setBusy] = useState(session.pending !== null);
  const [dirty, setDirty] = useState(session.dirty);
  const [saving, setSaving] = useState(session.exporting !== null);
  const [picking, setPicking] = useState(session.selecting !== null);
  const [stopping, setStopping] = useState(false);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<unknown>(session.error);
  const alive = useRef(false);
  const closing = useRef(false);
  const init = useRef(() => {});
  const invalidFields = new Set(
    Object.entries(fields)
      .filter(
        ([, value]) =>
          new TextEncoder().encode(value).length > EXTENSION_FIELD_BYTES,
      )
      .map(([id]) => id),
  );
  const blocked =
    busy ||
    saving ||
    stopping ||
    picking ||
    session.exporting !== null ||
    session.pending !== null ||
    runningId !== null;
  const status = stopping
    ? t("ext.stopping")
    : busy
      ? t("ext.appWorking")
      : runningId
        ? t("ext.running", { id: runningId })
        : "";

  function run(action: string | null, data?: ExtensionViewDataInput) {
    if (
      session.pending ||
      session.exporting ||
      session.selecting ||
      closing.current ||
      invalidFields.size > 0 ||
      runningId !== null ||
      !item.enabled
    )
      return;
    setBusy(true);
    setError(null);
    session.error = null;
    const pending = viewExtension({
      id: manifest.id,
      commandId,
      expectedSha256: item.package.sha256,
      data,
      request: {
        version: 1,
        action,
        state: session.view?.state ?? "",
        fields: session.fields,
        locale: language === "zh" ? "zh-CN" : "en",
      },
    })
      .then((next) => {
        latest.current = next;
        latestFields.current = Object.fromEntries(
          next.fields.map((field) => [field.id, field.value]),
        );
        session.view = next;
        session.fields = latestFields.current;
        if (action !== null) session.dirty = true;
        if (alive.current) {
          setView(next);
          setFields(latestFields.current);
          if (action !== null) setDirty(true);
        }
      })
      .catch((reason: unknown) => {
        session.error = reason;
        if (alive.current) setError(reason);
      })
      .finally(() => {
        if (session.pending === pending) session.pending = null;
        if (alive.current) {
          setBusy(false);
          setStopping(false);
        }
        void onSettled();
      });
    session.pending = pending;
  }
  init.current = () => run(null);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    // StrictMode's first setup is disposed before any Wasm request is sent.
    queueMicrotask(() => {
      if (!disposed && !latest.current) init.current();
    });
    return () => {
      disposed = true;
      alive.current = false;
      if (session.pending) void cancelExtension(manifest.id).catch(() => {});
    };
  }, [manifest.id, session]);
  useEffect(() => {
    let stopped = false;
    const pending = session.pending;
    if (pending)
      void pending.then(() => {
        if (!stopped) {
          latest.current = session.view;
          latestFields.current = session.fields;
          setView(session.view);
          setFields(session.fields);
          setDirty(session.dirty);
          setError(session.error);
          setBusy(false);
          setStopping(false);
        }
      });
    const selecting = session.selecting;
    if (selecting)
      void selecting.then(() => {
        if (!stopped) setPicking(false);
      });
    return () => {
      stopped = true;
    };
  }, [session]);
  useEffect(() => {
    let stopped = false;
    const exporting = session.exporting;
    if (exporting)
      void exporting.then(
        () => {
          if (!stopped) {
            setSaving(false);
            setDirty(session.dirty);
          }
        },
        (reason: unknown) => {
          if (!stopped) {
            setSaving(false);
            setDirty(session.dirty);
            setError(reason);
          }
        },
      );
    return () => {
      stopped = true;
    };
  }, [session]);
  useEffect(() => {
    if (!session.pending && latest.current !== session.view) {
      latest.current = session.view;
      latestFields.current = session.fields;
      setView(session.view);
      setFields(session.fields);
      setDirty(session.dirty);
    }
  }, [session, session.pending, session.view, session.fields, session.dirty]);
  async function settle(signal?: AbortSignal) {
    signal?.throwIfAborted();
    await session.selecting;
    signal?.throwIfAborted();
    const pending = session.pending;
    if (pending) {
      await cancelExtension(manifest.id);
      await pending;
      signal?.throwIfAborted();
    }
  }
  async function save(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (session.exporting || closing.current)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    if (alive.current) setSaving(true);
    const pending = (async () => {
      try {
        await settle(signal);
        signal?.throwIfAborted();
        const saved = await saveTextExport(
          `${manifest.id}-session.json`,
          JSON.stringify(
            {
              extensionId: manifest.id,
              commandId,
              view: session.view,
              fields: session.fields,
              inputText: session.draft.inputText,
              files: session.draft.files.map((file) => file.name),
              url: session.draft.url,
            },
            null,
            2,
          ),
        );
        signal?.throwIfAborted();
        if (saved === null)
          throw new NativeBridgeError({
            code: "USER_CANCELLED",
            message: "Export cancelled",
            retryable: false,
          });
        session.dirty = false;
        if (alive.current) setDirty(false);
      } finally {
        session.exporting = null;
        if (alive.current) setSaving(false);
      }
    })();
    session.exporting = pending;
    await pending;
  }
  useUnsavedWork({
    id: workId,
    label: manifest.name,
    dirty: !closed && (dirty || busy || saving || picking),
    save,
    discard: async (signal) => {
      await settle(signal);
      signal?.throwIfAborted();
      latest.current = null;
      latestFields.current = {};
      session.view = null;
      session.fields = {};
      session.dirty = false;
      session.draft = { inputText: "", url: "", files: [] };
      if (alive.current) {
        setView(null);
        setFields({});
        setDirty(false);
      }
    },
  });
  useEffect(() => {
    if (closed) onClose();
  }, [closed, onClose]);
  async function close() {
    if (session.exporting || closing.current) return;
    closing.current = true;
    setStopping(true);
    try {
      await settle();
      latest.current = null;
      latestFields.current = {};
      session.view = null;
      session.fields = {};
      session.dirty = false;
      session.draft = { inputText: "", url: "", files: [] };
      if (alive.current) setClosed(true);
    } catch (reason) {
      closing.current = false;
      if (alive.current) {
        setError(reason);
        setStopping(false);
      }
    }
  }
  return (
    <section className="min-w-0 space-y-5" hidden={closed}>
      <p className="text-sm text-muted-foreground">{t("ext.appSessionHint")}</p>
      <div className="min-w-0 space-y-5" aria-busy={busy}>
        {view ? (
          <>
            <div className="min-w-0 space-y-2 rounded-xl border bg-muted/20 p-5">
              <output
                className="block max-h-28 overflow-auto whitespace-pre-wrap break-words text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-live="polite"
                aria-label={t("ext.output")}
                tabIndex={0}
              >
                {view.display}
              </output>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {view.description}
              </p>
            </div>
            <ViewRenderer
              view={view}
              fields={fields}
              blocked={blocked}
              invalidFields={invalidFields}
              onAction={run}
              onField={(id, value) => {
                const next = { ...latestFields.current, [id]: value };
                latestFields.current = next;
                session.fields = next;
                session.dirty = true;
                setFields(next);
                setDirty(true);
              }}
            />
          </>
        ) : (
          <Button
            disabled={blocked || !item.enabled}
            data-operation-locked={blocked && item.enabled}
            className={LOCKED_CONTROL_CLASS}
            onClick={() => run(null)}
          >
            {t("ext.appLoad")}
          </Button>
        )}
      </div>
      <ExtensionData
        item={item}
        blocked={blocked || invalidFields.size > 0}
        session={session}
        onDirty={() => setDirty(true)}
        onPickingChange={(value) => {
          if (alive.current) setPicking(value);
        }}
        onSend={(data) => run("host-data", data)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {nativeErrorText(error, t)}
        </p>
      ) : null}
      <p
        role="status"
        aria-label={t("ext.appStatus")}
        aria-live="polite"
        aria-atomic="true"
        title={status || undefined}
        className="h-5 truncate text-sm text-muted-foreground"
      >
        {status}
      </p>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          variant="outline"
          disabled={saving || stopping || picking || !view}
          data-operation-locked={
            (saving || stopping || picking) && view !== null
          }
          className={LOCKED_CONTROL_CLASS}
          title={t("ext.appExportHint")}
          onClick={() =>
            void save().catch((reason: unknown) => {
              if (alive.current) setError(reason);
            })
          }
        >
          {t("ext.appExport")}
        </Button>
        <Button
          variant="outline"
          disabled={!busy || stopping}
          data-operation-locked={busy && stopping}
          className={LOCKED_CONTROL_CLASS}
          title={t("ext.appStopHint")}
          onClick={() => {
            setStopping(true);
            void settle().catch((reason: unknown) => {
              if (alive.current) {
                setError(reason);
                setStopping(false);
              }
            });
          }}
        >
          {t("ext.stop")}
        </Button>
        <Button
          variant="secondary"
          disabled={saving || stopping || picking}
          data-operation-locked={saving || stopping || picking}
          className={LOCKED_CONTROL_CLASS}
          title={t("ext.appCloseHint")}
          onClick={() => void close()}
        >
          {t("ext.appClose")}
        </Button>
      </div>
    </section>
  );
}

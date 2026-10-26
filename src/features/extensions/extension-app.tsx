import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { useUnsavedWork } from "@/providers/unsaved-work";
import { nativeErrorText } from "@/lib/native-error";
import {
  cancelExtension,
  viewExtension,
  saveTextExport,
  saveExtensionArtifact,
  requestExtensionService,
  type ExtensionSnapshot,
  NativeBridgeError,
  type ExtensionInfo,
  type ExtensionView,
  type ExtensionViewDataInput,
} from "@/lib/tauri";
import {
  ExtensionView as ViewRenderer,
  extensionFieldBytes,
} from "./extension-view";
import { extensionInstallationIdentity } from "./extension-model";
import { useExtensionPhase } from "./use-extension-phase";
import { ExtensionSessionImport } from "./extension-session-import";
import { ExtensionSessionClose } from "./extension-session-close";
import {
  extensionSessionIdentity,
  type ExtensionSessionExport,
} from "./extension-session";
import { ExtensionData } from "./extension-data";
import { useExtensionSession } from "./extensions-provider";
import { LOCKED_CONTROL_CLASS } from "./control-styles";
import { ExtensionFrame, ExtensionToolGroup } from "./extension-frame";
import { ExtensionCustomUi } from "./extension-custom-ui";
import type { ExtensionUiRequest } from "./extension-ui-bridge";
import { useDelayedBusy } from "./use-delayed-busy";

/** The renderer has no calculator/game rules. Every action runs the declared Wasm export. */
export function ExtensionApp({
  item,
  commandId,
  runs,
  onClose,
  onSettled,
  tools,
}: {
  item: ExtensionInfo;
  commandId: string;
  runs: ExtensionSnapshot["runs"];
  onClose: () => void;
  onSettled: () => Promise<void>;
  tools?: ReactNode;
}) {
  const { t, language } = useI18n();
  const manifest = item.package.manifest;
  const documentId = manifest.commands.find(
    (command) => command.id === commandId,
  )?.ui?.document;
  const documentHash = item.package.uiDocuments?.find(
    (document) => document.id === documentId,
  )?.sha256;
  const phase = useExtensionPhase(runs, manifest.id);
  const workId = `extension-app:${manifest.id}:${commandId}:${extensionInstallationIdentity(item)}`;
  const session = useExtensionSession(
    `${manifest.id}:${commandId}`,
    extensionInstallationIdentity(item),
  );
  const [view, setView] = useState<ExtensionView | null>(session.view);
  const [uiState, setUiState] = useState(session.uiState ?? null);
  const latest = useRef<ExtensionView | null>(session.view);
  const [fields, setFields] = useState<Record<string, string>>(session.fields);
  const latestFields = useRef(fields);
  const [busy, setBusy] = useState(session.pending !== null);
  const [dirty, setDirty] = useState(session.dirty);
  const [saving, setSaving] = useState(session.exporting !== null);
  const [picking, setPicking] = useState(session.selecting !== null);
  const [stopping, setStopping] = useState(false);
  const showProgress = useDelayedBusy(busy || stopping);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<unknown>(session.error);
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const alive = useRef(false);
  const closing = useRef(false);
  const init = useRef(() => {});
  const localeRefresh = useRef<string | null>(null);
  const invalidFields = new Set(
    Object.entries(fields)
      .filter(([id, value]) => {
        const field = view?.fields.find((field) => field.id === id);
        return (
          new TextEncoder().encode(value).length >
          (field ? extensionFieldBytes(field) : 64 * 1024)
        );
      })
      .map(([id]) => id),
  );
  if (
    Object.values(fields).reduce(
      (sum, value) => sum + new TextEncoder().encode(value).length,
      0,
    ) >
    1024 * 1024
  )
    Object.keys(fields).forEach((id) => invalidFields.add(id));
  const blocked =
    busy ||
    saving ||
    stopping ||
    picking ||
    session.exporting !== null ||
    session.pending !== null;
  const status = !showProgress
    ? ""
    : stopping
      ? t("ext.stopping")
      : busy
        ? t(phase === "queued" ? "ext.queued" : "ext.appWorking")
        : "";

  function run(
    action: string | null,
    data?: ExtensionViewDataInput,
    validatedUiFields = false,
    refreshLocale = false,
  ) {
    if (
      session.pending ||
      session.exporting ||
      session.selecting ||
      closing.current ||
      (!validatedUiFields && invalidFields.size > 0) ||
      !item.enabled
    )
      return;
    setBusy(true);
    setError(null);
    session.error = null;
    const locale = language === "zh" ? "zh-CN" : "en";
    const draftFields = refreshLocale ? { ...session.fields } : null;
    const pending = viewExtension({
      id: manifest.id,
      commandId,
      expectedSha256: item.package.sha256,
      expectedGeneration: item.generation,
      data,
      request: {
        version: 2,
        host: null,
        results: [],
        action,
        state: session.view?.state ?? "",
        fields: session.fields,
        locale,
      },
    })
      .then((next) => {
        if (draftFields)
          next = {
            ...next,
            fields: next.fields.map((field) => ({
              ...field,
              value: draftFields[field.id] ?? field.value,
            })),
          };
        latest.current = next;
        latestFields.current = Object.fromEntries(
          next.fields.map((field) => [field.id, field.value]),
        );
        session.view = next;
        session.locale = locale;
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
    return pending;
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
      if (session.pending)
        void cancelExtension(manifest.id, item.generation).catch(() => {});
    };
  }, [manifest.id, item.generation, session]);
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
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void onSettled(), 750);
    return () => window.clearInterval(timer);
  }, [busy, onSettled]);
  useEffect(() => {
    const locale = language === "zh" ? "zh-CN" : "en";
    if (session.locale === locale) localeRefresh.current = null;
    if (
      !session.view ||
      session.locale === locale ||
      localeRefresh.current === locale ||
      invalidFields.size > 0 ||
      session.pending ||
      session.exporting ||
      session.selecting ||
      busy ||
      saving ||
      picking ||
      stopping ||
      closed
    )
      return;
    localeRefresh.current = locale;
    // null + existing state only renders the same session in the requested locale.
    // In-flight actions settle first; a later language change is picked up afterward.
    void run(null, undefined, false, true);
  });
  async function settle(signal?: AbortSignal, waitForExport = false) {
    signal?.throwIfAborted();
    await session.selecting;
    signal?.throwIfAborted();
    if (waitForExport) {
      await session.exporting;
      signal?.throwIfAborted();
    }
    const pending = session.pending;
    if (pending) {
      await cancelExtension(manifest.id, item.generation);
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
              formatVersion: 1,
              kind: "view",
              ...extensionSessionIdentity(item, commandId),
              result: null,
              view: session.view,
              fields: session.fields,
              ...(documentHash
                ? {
                    ui: {
                      sha256: documentHash,
                      state: session.uiState ?? null,
                    },
                  }
                : {}),
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
      await settle(signal, true);
      signal?.throwIfAborted();
      latest.current = null;
      latestFields.current = {};
      session.view = null;
      session.uiState = null;
      session.fields = {};
      session.dirty = false;
      session.draft = { inputText: "", url: "", files: [] };
      if (alive.current) {
        setView(null);
        setUiState(null);
        setFields({});
        setDirty(false);
      }
    },
  });
  useEffect(() => {
    if (closed) onClose();
  }, [closed, onClose]);
  async function close(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (session.exporting || closing.current)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    closing.current = true;
    setStopping(true);
    try {
      await settle(signal);
      signal?.throwIfAborted();
      latest.current = null;
      latestFields.current = {};
      session.view = null;
      session.uiState = null;
      session.fields = {};
      session.dirty = false;
      session.draft = { inputText: "", url: "", files: [] };
      if (alive.current) setClosed(true);
    } catch (reason) {
      closing.current = false;
      if (alive.current) {
        setStopping(false);
      }
      throw reason;
    }
  }
  function updateUiFields(patch: Record<string, string>) {
    if (
      session.pending ||
      session.exporting ||
      session.selecting ||
      closing.current
    )
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    const next = { ...session.fields, ...patch };
    if (
      Object.entries(next).some(([id, value]) => {
        const field = session.view?.fields.find((field) => field.id === id);
        return (
          !field ||
          new TextEncoder().encode(value).length > extensionFieldBytes(field)
        );
      }) ||
      Object.values(next).reduce(
        (sum, value) => sum + new TextEncoder().encode(value).length,
        0,
      ) >
        1024 * 1024
    )
      throw new NativeBridgeError({
        code: "INVALID_ARGUMENT",
        message: "Invalid UI fields",
        retryable: false,
      });
    session.fields = next;
    latestFields.current = next;
    session.dirty = true;
    if (alive.current) {
      setFields(next);
      setDirty(true);
    }
  }
  async function saveArtifact(index: number) {
    const artifact = session.view?.artifacts?.[index];
    if (
      !artifact ||
      session.pending ||
      session.exporting ||
      session.selecting ||
      closing.current
    )
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Artifact is unavailable or session is busy",
        retryable: false,
      });
    let saved = false;
    if (alive.current) setSaving(true);
    const pending = saveExtensionArtifact(
      manifest.id,
      item.package.sha256,
      item.generation,
      artifact,
    )
      .then((path) => {
        saved = path !== null;
      })
      .finally(() => {
        session.exporting = null;
        if (alive.current) setSaving(false);
      });
    session.exporting = pending;
    await pending;
    return saved;
  }
  async function executeUi(request: ExtensionUiRequest): Promise<unknown> {
    if (closed || closing.current || !item.enabled)
      throw new NativeBridgeError({
        code: "EXTENSION_UNAVAILABLE",
        message: "Session is closed",
        retryable: false,
      });
    if (request.method === "service")
      return requestExtensionService(
        manifest.id,
        item.package.sha256,
        item.generation,
        request.service,
        request.request,
      );
    if (request.method === "artifact") return saveArtifact(request.index);
    if (request.method === "checkpoint") {
      if (
        session.exporting ||
        closing.current ||
        (!request.dirty && (session.pending || session.selecting))
      )
        throw new NativeBridgeError({
          code: "CONFLICT",
          message: "Session is busy",
          retryable: false,
        });
      session.uiState = request.value;
      session.dirty = request.dirty;
      if (alive.current) {
        setUiState(request.value);
        setDirty(request.dirty);
      }
      return null;
    }
    updateUiFields(request.fields);
    if (request.method === "fields") return null;
    const pending = run(request.action, undefined, true);
    if (!pending)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    await pending;
    if (session.error) throw session.error;
    return session.view;
  }
  const feedback = (
    <div className="grid h-7 w-[min(15rem,42vw)] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <p
        role="status"
        aria-label={t("ext.appStatus")}
        aria-live="polite"
        aria-atomic="true"
        title={status || undefined}
        className="min-w-0 truncate text-xs text-muted-foreground"
      >
        {status}
      </p>
      <Button
        variant="outline"
        size="sm"
        aria-hidden={!showProgress}
        tabIndex={showProgress ? 0 : -1}
        disabled={!showProgress || !busy || stopping}
        style={{ visibility: showProgress ? undefined : "hidden" }}
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
    </div>
  );
  return (
    <section className="min-w-0 space-y-5" hidden={closed}>
      <ExtensionFrame
        item={item}
        feedback={feedback}
        tools={
          <>
            {tools || documentId ? (
              <ExtensionToolGroup label={t("ext.tools.interface")}>
                <div className="flex flex-wrap gap-2">
                  {tools}
                  {documentId ? (
                    <Button
                      variant="outline"
                      disabled={blocked}
                      onClick={() => setSurfaceRevision((value) => value + 1)}
                    >
                      {t("ext.reloadUi")}
                    </Button>
                  ) : null}
                </div>
              </ExtensionToolGroup>
            ) : null}
            <ExtensionToolGroup label={t("ext.tools.session")}>
              <div className="space-y-3">
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
                <ExtensionSessionImport
                  item={item}
                  commandId={commandId}
                  kind="view"
                  blocked={blocked}
                  onError={(reason) => {
                    if (alive.current) setError(reason);
                  }}
                  onPending={(pending, completed) => {
                    if (pending !== null || session.selecting === completed) {
                      session.selecting = pending;
                      if (alive.current) setPicking(pending !== null);
                    }
                  }}
                  onRestore={(imported: ExtensionSessionExport) => {
                    latest.current = imported.view;
                    latestFields.current = imported.fields;
                    session.view = imported.view;
                    session.locale = language === "zh" ? "zh-CN" : "en";
                    session.uiState = imported.ui?.state ?? null;
                    session.fields = imported.fields;
                    session.draft = {
                      inputText: imported.inputText,
                      url: imported.url,
                      files: [],
                    };
                    session.dirty = true;
                    setView(imported.view);
                    setUiState(session.uiState);
                    setFields(imported.fields);
                    setDirty(true);
                    setError(null);
                    setSurfaceRevision((value) => value + 1);
                  }}
                />
              </div>
            </ExtensionToolGroup>
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
            <ExtensionToolGroup label={t("ext.tools.lifecycle")}>
              <ExtensionSessionClose
                dirty={dirty || session.dirty}
                busy={busy}
                disabled={saving || stopping || picking}
                onSave={save}
                onClose={close}
              />
            </ExtensionToolGroup>
          </>
        }
      >
        <div className="min-w-0 space-y-5" aria-busy={busy}>
          {documentId ? (
            <ExtensionCustomUi
              key={surfaceRevision}
              item={item}
              commandId={commandId}
              view={view}
              fields={fields}
              checkpoint={uiState}
              busy={blocked}
              dirty={dirty}
              execute={executeUi}
            />
          ) : view ? (
            <>
              <div className="min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <output
                    className="block min-w-0 flex-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-live="polite"
                    aria-label={t("ext.output")}
                    tabIndex={0}
                  >
                    {view.display}
                  </output>
                </div>
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
            <>
              <Button
                disabled={blocked || !item.enabled}
                data-operation-locked={blocked && item.enabled}
                className={LOCKED_CONTROL_CLASS}
                onClick={() => run(null)}
              >
                {t("ext.appLoad")}
              </Button>
            </>
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {nativeErrorText(error, t)}
          </p>
        ) : null}
        {!documentId && view?.artifacts?.length ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("ext.artifacts")}</h4>
            <div className="flex flex-wrap gap-2">
              {view.artifacts.map((artifact, index) => (
                <Button
                  key={artifact.name}
                  variant="outline"
                  disabled={blocked}
                  onClick={() => {
                    void saveArtifact(index).catch((reason: unknown) => {
                      if (alive.current) setError(reason);
                    });
                  }}
                >
                  {t("ext.saveArtifact", { name: artifact.name })}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </ExtensionFrame>
    </section>
  );
}

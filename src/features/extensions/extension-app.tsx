import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { Button } from "@/components/ui/button";
import {
  DownloadIcon,
  UploadIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/providers/i18n";
import { useUnsavedWork } from "@/providers/unsaved-work";
import { nativeErrorText } from "@/lib/native-error";
import {
  cancelExtension,
  viewExtension,
  saveExtensionSession,
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
import {
  ExtensionSessionClose,
  type ExtensionSessionCloseHandle,
} from "./extension-session-close";
import {
  extensionSessionIdentity,
  serializeExtensionSession,
  type ExtensionSessionExport,
} from "./extension-session";
import { ExtensionData } from "./extension-data";
import { useExtensionSession } from "./extensions-provider";
import { LOCKED_CONTROL_CLASS } from "./control-styles";
import { ExtensionFrame } from "./extension-frame";
import { ExtensionCustomUi } from "./extension-custom-ui";
import type { ExtensionUiRequest } from "./extension-ui-bridge";
import { useDelayedBusy } from "./use-delayed-busy";
import { ExtensionLoading } from "./extension-loading";

function validateFieldDrafts(
  view: ExtensionView | null,
  fields: Record<string, string>,
) {
  const invalidFields = new Set<string>();
  const invalidFieldValues = new Set<string>();
  let bytes = 0;
  for (const [id, value] of Object.entries(fields)) {
    const field = view?.fields.find((field) => field.id === id);
    const size = new TextEncoder().encode(value).length;
    bytes += size;
    if (!field || size > extensionFieldBytes(field)) {
      invalidFields.add(id);
      continue;
    }
    let valid = true;
    if (field.kind === "checkbox")
      valid = value === "true" || value === "false";
    else if (field.kind === "select")
      valid = (field.options ?? []).some((option) => option.value === value);
    else if ((field.kind === "number" || field.kind === "date") && value) {
      const input = document.createElement("input");
      input.type = field.kind;
      input.value = value;
      valid =
        input.value === value &&
        (field.kind === "number"
          ? Number.isFinite(input.valueAsNumber)
          : value.length === 10);
    }
    if (!valid) {
      invalidFields.add(id);
      invalidFieldValues.add(id);
    }
  }
  if (bytes > 1024 * 1024)
    Object.keys(fields).forEach((id) => {
      invalidFields.add(id);
      invalidFieldValues.delete(id);
    });
  return { invalidFields, invalidFieldValues };
}

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
  const [dataOpen, setDataOpen] = useState(false);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const closeControl = useRef<ExtensionSessionCloseHandle>(null);
  const hasHostData = item.grantedPermissions.some((permission) =>
    ["text:read", "files:read", "network:https", "network:local"].includes(
      permission,
    ),
  );
  const alive = useRef(false);
  const closing = useRef(false);
  const init = useRef(() => {});
  const notifiedError = useRef<unknown>(null);
  useEffect(() => {
    if (!error) notifiedError.current = null;
    else if (view && notifiedError.current !== error) {
      notifiedError.current = error;
      toast.error(nativeErrorText(error, t), {
        id: `${workId}:notification`,
        description: manifest.name,
      });
    }
  }, [error, view, t, workId, manifest.name]);
  const localeRefresh = useRef<string | null>(null);
  const { invalidFields, invalidFieldValues } = validateFieldDrafts(
    view,
    fields,
  );
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
    refreshLocale = false,
  ) {
    if (
      session.pending ||
      session.exporting ||
      session.selecting ||
      closing.current ||
      validateFieldDrafts(session.view, session.fields).invalidFields.size >
        0 ||
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
        latest.current = next;
        // 原生视图保持已验证原件，语言刷新只在独立字段草稿中保留未提交输入。
        latestFields.current = Object.fromEntries(
          next.fields.map((field) => [
            field.id,
            draftFields?.[field.id] ?? field.value,
          ]),
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
      validateFieldDrafts(session.view, session.fields).invalidFields.size >
        0 ||
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
    // 无效草稿修正后仍可刷新语言；仅已开始的尝试阻止失败后的自动重试。
    const pending = run(null, undefined, true);
    if (pending) localeRefresh.current = locale;
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
        const saved = await saveExtensionSession(
          `${manifest.id}-session.json`,
          serializeExtensionSession({
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
          }),
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
    if (!alive.current || closed || closing.current || !item.enabled)
      throw new NativeBridgeError({
        code: "EXTENSION_UNAVAILABLE",
        message: "Session is closed",
        retryable: false,
      });
    if (request.method === "notify") {
      toast[request.tone](request.message, {
        id: `${workId}:notification`,
        description: manifest.name,
      });
      return null;
    }
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
    if (
      validateFieldDrafts(session.view, session.fields).invalidFields.size > 0
    )
      throw new NativeBridgeError({
        code: "INVALID_ARGUMENT",
        message: "Correct invalid field drafts before running the extension",
        retryable: false,
      });
    const pending = run(request.action);
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
  return (
    <section className="min-w-0 space-y-5" hidden={closed}>
      <ExtensionFrame
        item={item}
        announcement={status}
        triggerRef={toolsTrigger}
        tools={
          <>
            {tools}
            {documentId ? (
              <DropdownMenuItem
                disabled={blocked}
                onSelect={() => setSurfaceRevision((value) => value + 1)}
              >
                <RefreshCwIcon />
                {t("ext.reloadUi")}
              </DropdownMenuItem>
            ) : null}
            {tools || documentId ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={saving || stopping || picking || !view}
              onSelect={() => {
                void save().catch((reason: unknown) => {
                  if (alive.current) setError(reason);
                });
              }}
            >
              <DownloadIcon />
              {t("ext.appExport")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={blocked}
              onSelect={() => importInput.current?.click()}
            >
              <UploadIcon />
              {t("ext.importSession")}
            </DropdownMenuItem>
            {hasHostData ? (
              <DropdownMenuItem
                disabled={blocked || invalidFields.size > 0}
                onSelect={() => setDataOpen(true)}
              >
                <SendIcon />
                {t("ext.sendDataMenu")}
              </DropdownMenuItem>
            ) : null}
            {showProgress ? (
              <DropdownMenuItem
                disabled={!busy || stopping}
                onSelect={() => {
                  setStopping(true);
                  void settle().catch((reason: unknown) => {
                    if (alive.current) {
                      setError(reason);
                      setStopping(false);
                    }
                  });
                }}
              >
                <SquareIcon />
                {t("ext.stop")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={saving || stopping || picking}
              onSelect={() => closeControl.current?.requestClose()}
            >
              <XIcon />
              {t("ext.appClose")}
            </DropdownMenuItem>
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
          ) : !view && busy ? (
            <ExtensionLoading />
          ) : view ? (
            <>
              <div className="min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <output
                    className="block h-16 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-live="polite"
                    aria-label={t("ext.output")}
                    tabIndex={0}
                  >
                    {view.display}
                  </output>
                  {view.description ? (
                    <HelpTooltip
                      label={t("common.helpFor", { name: t("ext.output") })}
                    >
                      {view.description}
                    </HelpTooltip>
                  ) : null}
                </div>
              </div>
              <ViewRenderer
                view={view}
                fields={fields}
                blocked={blocked}
                invalidFields={invalidFields}
                invalidFieldValues={invalidFieldValues}
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
        {error && !view ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(error, t)}
            </p>
            {documentId && !view ? (
              <Button
                variant="outline"
                disabled={blocked}
                onClick={() => run(null)}
              >
                {t("common.retry")}
              </Button>
            ) : null}
          </div>
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
      <ExtensionSessionImport
        presentation="hidden"
        inputRef={importInput}
        returnFocusRef={toolsTrigger}
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
      <ExtensionData
        presentation="dialog"
        open={dataOpen}
        onOpenChange={setDataOpen}
        returnFocusRef={toolsTrigger}
        item={item}
        blocked={blocked || invalidFields.size > 0}
        session={session}
        onDirty={() => setDirty(true)}
        onPickingChange={(value) => {
          if (alive.current) setPicking(value);
        }}
        onSend={(data) => {
          run("host-data", data);
          setDataOpen(false);
        }}
      />
      <ExtensionSessionClose
        ref={closeControl}
        showTrigger={false}
        returnFocusRef={toolsTrigger}
        dirty={dirty || session.dirty}
        busy={busy}
        disabled={saving || stopping || picking}
        onSave={save}
        onClose={close}
      />
    </section>
  );
}

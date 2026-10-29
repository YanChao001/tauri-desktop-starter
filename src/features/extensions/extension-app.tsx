import { getLocale } from "@/i18n/registry";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { flushSync } from "react-dom";
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
  extensionFieldBytes,
  extensionInstallationIdentity,
} from "./extension-model";
import { ExtensionView as ViewRenderer } from "./extension-view";
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
import { useExtensionActivity } from "./extension-activity";

function validateFieldDrafts(
  view: ExtensionView | null,
  fields: Record<string, string>,
  policy: "generic-form" | "custom-ui",
) {
  const invalidFields = new Set<string>();
  const invalidFieldValues = new Set<string>();
  let bytes = 0;
  for (const [id, value] of Object.entries(fields)) {
    const field = view?.fields.find((field) => field.id === id);
    if (typeof value !== "string" || value.includes("\0")) {
      invalidFields.add(id);
      continue;
    }
    const size = new TextEncoder().encode(value).length;
    bytes += size;
    if (!field || size > extensionFieldBytes(field)) {
      invalidFields.add(id);
      continue;
    }
    let valid = true;
    if (field.kind === "checkbox")
      valid = value === "true" || value === "false";
    // A custom UI can change a parent and dependent select in the same action.
    // Only the plugin can validate that new context; the old options are stale.
    else if (field.kind === "select" && policy === "generic-form")
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
  onClose: (signal?: AbortSignal) => void | Promise<void>;
  onSettled: () => Promise<void>;
  tools?: ReactNode;
}) {
  const { t, language } = useI18n();
  const active = useExtensionActivity();
  const activity = useRef(active);
  useLayoutEffect(() => {
    activity.current = active;
  }, [active]);
  const manifest = item.package.manifest;
  const documentId = manifest.commands.find(
    (command) => command.id === commandId,
  )?.ui?.document;
  const fieldDraftPolicy = documentId ? "custom-ui" : "generic-form";
  const documentHash = item.package.uiDocuments?.find(
    (document) => document.id === documentId,
  )?.sha256;
  const workId = `extension-app:${manifest.id}:${commandId}:${extensionInstallationIdentity(item)}`;
  const session = useExtensionSession(
    `${manifest.id}:${commandId}`,
    extensionInstallationIdentity(item),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { view, fields, dirty, error } = state;
  const uiState = state.uiState ?? null;
  const busy = state.pending !== null;
  const phase = useExtensionPhase(runs, manifest.id, busy && active);
  const saving = state.exporting !== null;
  const picking = state.selecting !== null;
  const [stopping, setStopping] = useState(false);
  const showProgress = useDelayedBusy(busy || stopping);
  const [closed, setClosed] = useState(false);
  const previousActivity = useRef(active);
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
  const setError = (error: unknown) => session.update({ error });
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
    fieldDraftPolicy,
  );
  const blocked = busy || saving || stopping || picking;
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
    const current = session.getSnapshot();
    if (
      current.pending ||
      current.exporting ||
      current.selecting ||
      closing.current ||
      !activity.current ||
      validateFieldDrafts(current.view, current.fields, fieldDraftPolicy)
        .invalidFields.size > 0 ||
      !item.enabled
    )
      return;
    session.update({ error: null });
    const locale = getLocale(language).documentLang;
    const draftFields = refreshLocale ? current.fields : null;
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
        state: current.view?.state ?? "",
        fields: current.fields,
        locale,
      },
    })
      .then((next) => {
        // 原生视图保持已验证原件，语言刷新只在独立字段草稿中保留未提交输入。
        const fields = Object.fromEntries(
          next.fields.map((field) => [
            field.id,
            draftFields && Object.hasOwn(draftFields, field.id)
              ? (draftFields[field.id] ?? field.value)
              : field.value,
          ]),
        );
        session.update({
          view: next,
          locale,
          fields,
          ...(action !== null ? { dirty: true } : {}),
        });
      })
      .catch((reason: unknown) => {
        session.update({ error: reason });
      })
      .finally(() => {
        if (session.getSnapshot().pending === pending)
          session.update({ pending: null });
        if (alive.current) setStopping(false);
        void onSettled();
      });
    session.update({ pending });
    return pending;
  }
  useLayoutEffect(() => {
    init.current = () => run(null);
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (session.getSnapshot().pending)
        void cancelExtension(manifest.id, item.generation).catch(() => {});
    };
  }, [manifest.id, item.generation, session]);
  useEffect(() => {
    const resumed = active && !previousActivity.current;
    previousActivity.current = active;
    if (!active) {
      setDataOpen(false);
      return;
    }
    if (closed && !resumed) return;
    let disposed = false;
    // StrictMode 的首次清理先于请求；缓存页面恢复时只初始化尚无视图的会话。
    queueMicrotask(() => {
      if (disposed || !activity.current) return;
      if (closed) {
        closing.current = false;
        setClosed(false);
        setSurfaceRevision((value) => value + 1);
      }
      if (!session.getSnapshot().view) init.current();
    });
    return () => {
      disposed = true;
    };
  }, [active, closed, session]);
  useEffect(() => {
    const locale = getLocale(language).documentLang;
    if (state.locale === locale) localeRefresh.current = null;
    if (
      !active ||
      !view ||
      state.locale === locale ||
      localeRefresh.current === locale ||
      validateFieldDrafts(view, fields, fieldDraftPolicy).invalidFields.size >
        0 ||
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
    await session.getSnapshot().selecting;
    signal?.throwIfAborted();
    if (waitForExport) {
      await session.getSnapshot().exporting;
      signal?.throwIfAborted();
    }
    const pending = session.getSnapshot().pending;
    if (pending) {
      await cancelExtension(manifest.id, item.generation);
      await pending;
      signal?.throwIfAborted();
    }
  }
  async function save(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (session.getSnapshot().exporting || closing.current)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    const pending = (async () => {
      try {
        await settle(signal);
        signal?.throwIfAborted();
        const current = session.getSnapshot();
        const saved = await saveExtensionSession(
          `${manifest.id}-session.json`,
          serializeExtensionSession({
            formatVersion: 1,
            kind: "view",
            ...extensionSessionIdentity(item, commandId),
            result: null,
            view: current.view,
            fields: current.fields,
            ...(documentHash
              ? {
                  ui: {
                    sha256: documentHash,
                    state: current.uiState ?? null,
                  },
                }
              : {}),
            inputText: current.draft.inputText,
            files: current.draft.files.map((file) => file.name),
            url: current.draft.url,
          }),
        );
        signal?.throwIfAborted();
        if (saved === null)
          throw new NativeBridgeError({
            code: "USER_CANCELLED",
            message: "Export cancelled",
            retryable: false,
          });
        session.update({ dirty: false });
      } catch (error) {
        if (!signal?.aborted) session.update({ error });
        throw error;
      } finally {
        session.update({ exporting: null });
      }
    })();
    session.update({ exporting: pending });
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
      resetSession();
    },
  });
  function resetSession() {
    session.update({
      view: null,
      uiState: null,
      fields: {},
      dirty: false,
      draft: { inputText: "", url: "", files: [] },
    });
  }
  async function close(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (session.getSnapshot().exporting || closing.current)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    closing.current = true;
    setStopping(true);
    let previousDirty: boolean | undefined;
    try {
      await settle(signal);
      signal?.throwIfAborted();
      // The user already chose export/discard. Let native close negotiation see
      // that decision, while retaining the full draft until closing succeeds.
      previousDirty = session.getSnapshot().dirty;
      // Navigation can unmount immediately; publish the clean registration before
      // its cleanup decides whether to retain an off-page unsaved-work callback.
      flushSync(() => session.update({ dirty: false }));
      await onClose(signal);
      // 成功导航可能卸载页面，也可能只停用缓存页面；这两种清理都会终止对话框。
      // 当前页面仍活动时的显式取消，才保留用户此前的会话。
      if (alive.current && activity.current) signal?.throwIfAborted();
      resetSession();
      if (alive.current) setClosed(true);
    } catch (reason) {
      if (previousDirty !== undefined) session.update({ dirty: previousDirty });
      closing.current = false;
      if (alive.current) {
        setStopping(false);
      }
      throw reason;
    }
  }
  function updateUiFields(patch: Record<string, string>) {
    const current = session.getSnapshot();
    if (
      current.pending ||
      current.exporting ||
      current.selecting ||
      closing.current
    )
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    const next = { ...current.fields, ...patch };
    if (
      validateFieldDrafts(current.view, next, fieldDraftPolicy).invalidFields
        .size > 0
    )
      throw new NativeBridgeError({
        code: "INVALID_ARGUMENT",
        message: "Invalid UI fields",
        retryable: false,
      });
    session.update({ fields: next, dirty: true });
  }
  async function saveArtifact(index: number) {
    const current = session.getSnapshot();
    const artifact = current.view?.artifacts?.[index];
    if (
      !artifact ||
      current.pending ||
      current.exporting ||
      current.selecting ||
      closing.current
    )
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Artifact is unavailable or session is busy",
        retryable: false,
      });
    let saved = false;
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
        session.update({ exporting: null });
      });
    session.update({ exporting: pending });
    await pending;
    return saved;
  }
  async function executeUi(request: ExtensionUiRequest): Promise<unknown> {
    if (
      !alive.current ||
      !activity.current ||
      closed ||
      closing.current ||
      !item.enabled
    )
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
      const current = session.getSnapshot();
      if (
        current.exporting ||
        closing.current ||
        (!request.dirty && (current.pending || current.selecting))
      )
        throw new NativeBridgeError({
          code: "CONFLICT",
          message: "Session is busy",
          retryable: false,
        });
      session.update({ uiState: request.value, dirty: request.dirty });
      return null;
    }
    updateUiFields(request.fields);
    if (request.method === "fields") return null;
    const pending = run(request.action);
    if (!pending)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Session is busy",
        retryable: false,
      });
    await pending;
    const completed = session.getSnapshot();
    if (completed.error) throw completed.error;
    return completed.view;
  }
  return (
    <section className="min-w-0" hidden={closed}>
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
                  session.update({
                    fields: { ...session.getSnapshot().fields, [id]: value },
                    dirty: true,
                  });
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
          if (pending !== null || session.getSnapshot().selecting === completed)
            session.update({ selecting: pending });
        }}
        onRestore={(imported: ExtensionSessionExport) => {
          session.update({
            view: imported.view,
            locale: getLocale(language).documentLang,
            uiState: imported.ui?.state ?? null,
            fields: imported.fields,
            draft: {
              inputText: imported.inputText,
              url: imported.url,
              files: [],
            },
            dirty: true,
            error: null,
          });
          setSurfaceRevision((value) => value + 1);
        }}
      />
      <ExtensionData
        open={active && dataOpen}
        onOpenChange={setDataOpen}
        returnFocusRef={toolsTrigger}
        item={item}
        blocked={blocked || invalidFields.size > 0}
        session={session}
        onSend={(data) => {
          run("host-data", data);
          setDataOpen(false);
        }}
      />
      <ExtensionSessionClose
        ref={closeControl}
        returnFocusRef={toolsTrigger}
        dirty={dirty}
        busy={busy}
        disabled={saving || stopping || picking}
        onSave={save}
        onClose={close}
      />
    </section>
  );
}

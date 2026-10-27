import { ExtensionOutput } from "./extension-output";
import { toast } from "sonner";
import { ExtensionHelp } from "./extension-help";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/providers/i18n";
import { useUnsavedWork } from "@/providers/unsaved-work";
import { nativeErrorText } from "@/lib/native-error";
import {
  runExtension,
  cancelExtension,
  pickExtensionFiles,
  saveTextExport,
  saveExtensionSession,
  NativeBridgeError,
  type ExtensionInfo,
  type ExtensionSnapshot,
  type ExtensionResultFormat,
  type ExtensionFileChoice,
} from "@/lib/tauri";

import {
  canRunExtensionCommand,
  extensionNetworkOrigins,
} from "./extension-model";
import { useExtensionPhase } from "./use-extension-phase";
import { ExtensionSessionImport } from "./extension-session-import";
import {
  extensionSessionIdentity,
  serializeExtensionSession,
} from "./extension-session";
import { useDelayedBusy } from "./use-delayed-busy";
import { LOCKED_CONTROL_CLASS, LOCKED_INPUT_CLASS } from "./control-styles";

type FileChoice = Pick<ExtensionFileChoice, "id" | "name">;
type PendingRun = { id: string; generation: number; done: Promise<void> };

export function ExtensionRunner({
  items,
  runs,
  onSettled,
  requestedExtension = "",
  requestedCommand = "",
}: {
  requestedExtension?: string;
  requestedCommand?: string;
  items: ExtensionInfo[];
  runs: ExtensionSnapshot["runs"];
  onSettled: () => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [selected, setSelected] = useState("");
  const [nextSelected, setNextSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<FileChoice[]>([]);
  const latestFiles = useRef(files);
  const [output, setOutput] = useState<{
    extensionId: string;
    commandId: string;
    format: ExtensionResultFormat;
    text: string;
  } | null>(null);
  const lastOutput = useRef<typeof output>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (error)
      toast.error(nativeErrorText(error, t), { id: `extension-runner:${id}` });
  }, [error, t, id]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const showProgress = useDelayedBusy(busy || stopping);
  const [exporting, setExporting] = useState(false);
  const [picking, setPicking] = useState(false);
  const alive = useRef(false);
  const appliedRequest = useRef("");
  const current = useRef<PendingRun | null>(null);
  const selection = useRef<Promise<void> | null>(null);
  const exportLock = useRef(false);
  const selector = useRef<HTMLButtonElement>(null);
  const latestItems = useRef(items);
  latestItems.current = items;
  const enabled = items.filter((item) => item.enabled);
  const choices = enabled.flatMap((item) =>
    item.package.manifest.commands
      .filter(
        (command) =>
          command.resultFormat !== "view" &&
          canRunExtensionCommand(item, command),
      )
      .map((command) => ({
        item,
        command,
        key: `${item.package.manifest.id}:${command.id}:${item.generation}`,
      })),
  );
  const choice =
    choices.find((value) => value.key === selected) ??
    (selected
      ? undefined
      : (choices.find(
          (value) =>
            value.item.package.manifest.id === requestedExtension &&
            value.command.id === requestedCommand,
        ) ?? choices[0]));
  const lastChoice = useRef<typeof choice>(undefined);
  const exportChoice = choice ?? lastChoice.current;
  useEffect(() => {
    if (!choice) return;
    lastChoice.current = choice;
    if (!selected) setSelected(choice.key);
  }, [choice, selected]);
  const item = choice?.item;
  const phase = useExtensionPhase(runs, item?.package.manifest.id ?? "", busy);
  const grants = item?.grantedPermissions ?? [];
  const hasText = grants.includes("text:read");
  const hasFiles = grants.includes("files:read");
  const hasNetwork =
    grants.includes("network:https") || grants.includes("network:local");
  const tooLong = new TextEncoder().encode(input).length > 1024 * 1024;
  const locked = busy || exporting || picking;
  useEffect(() => {
    // Navigation from the command palette does not overwrite an unsaved session.
    const request = requestedExtension + ":" + requestedCommand;
    const requested = choices.find(
      (value) =>
        value.item.package.manifest.id === requestedExtension &&
        value.command.id === requestedCommand,
    );
    if (
      !requested ||
      dirty ||
      current.current ||
      appliedRequest.current === request
    )
      return;
    appliedRequest.current = request;
    setSelected(requested.key);
  }, [requestedExtension, requestedCommand, dirty, choices]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current.current)
        void cancelExtension(
          current.current.id,
          current.current.generation,
        ).catch(() => {});
    };
  }, []);
  function selectCommand(key: string) {
    lastOutput.current = null;
    latestFiles.current = [];
    setOutput(null);
    setFiles([]);
    setInput("");
    setUrl("");
    setError(null);
    setDirty(false);
    setSelected(key);
    setNextSelected(null);
  }
  async function settle(signal?: AbortSignal) {
    signal?.throwIfAborted();
    await selection.current;
    signal?.throwIfAborted();
    const pending = current.current;
    if (pending) {
      await cancelExtension(pending.id, pending.generation);
      await pending.done;
      signal?.throwIfAborted();
    }
  }
  async function save(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (exportLock.current)
      throw new NativeBridgeError({
        code: "CONFLICT",
        message: "Export is in progress",
        retryable: false,
      });
    exportLock.current = true;
    if (alive.current) setExporting(true);
    try {
      await settle(signal);
      const content = serializeExtensionSession({
        formatVersion: 1,
        kind: "tool",
        ...(exportChoice
          ? extensionSessionIdentity(exportChoice.item, exportChoice.command.id)
          : {}),
        fields: {},
        view: null,
        inputText: input,
        files: latestFiles.current.map((file) => file.name),
        url,
        result: lastOutput.current
          ? {
              format: lastOutput.current.format,
              text: lastOutput.current.text,
            }
          : null,
      });
      signal?.throwIfAborted();
      const saved = await saveExtensionSession(
        "extension-session.json",
        content,
      );
      signal?.throwIfAborted();
      if (saved === null)
        throw new NativeBridgeError({
          code: "USER_CANCELLED",
          message: "Export cancelled",
          retryable: false,
        });
      if (alive.current) setDirty(false);
    } finally {
      exportLock.current = false;
      if (alive.current) setExporting(false);
    }
  }
  useUnsavedWork({
    id: `extension-session:${id}`,
    label: t("ext.title"),
    dirty: dirty || busy || exporting || picking,
    save,
    discard: async (signal) => {
      await settle(signal);
      signal?.throwIfAborted();
      lastOutput.current = null;
      latestFiles.current = [];
      if (alive.current) {
        setInput("");
        setFiles([]);
        setUrl("");
        setOutput(null);
        setDirty(false);
      }
    },
  });
  function run() {
    if (
      !item ||
      !choice ||
      current.current ||
      exportLock.current ||
      locked ||
      (hasText && tooLong)
    )
      return;
    const extensionId = item.package.manifest.id;
    setBusy(true);
    setStopping(false);
    setError(null);
    const pending: PendingRun = {
      id: extensionId,
      generation: item.generation,
      done: Promise.resolve(),
    };
    current.current = pending;
    pending.done = runExtension({
      id: extensionId,
      commandId: choice.command.id,
      expectedSha256: item.package.sha256,
      expectedGeneration: item.generation,
      inputText: hasText ? input : "",
      fileIds: hasFiles ? files.map((file) => file.id) : [],
      url: hasNetwork && url.trim() ? url.trim() : null,
    })
      .then((text) => {
        if (
          current.current !== pending ||
          !latestItems.current.some(
            (installed) =>
              installed.package.manifest.id === extensionId &&
              installed.generation === pending.generation,
          )
        )
          return;
        lastOutput.current = {
          extensionId,
          commandId: choice.command.id,
          format: choice.command.resultFormat,
          text,
        };
        if (alive.current) {
          setOutput(lastOutput.current);
          setDirty(true);
        }
      })
      .catch((reason: unknown) => {
        if (
          alive.current &&
          current.current === pending &&
          latestItems.current.some(
            (installed) =>
              installed.package.manifest.id === extensionId &&
              installed.generation === pending.generation,
          )
        )
          setError(reason);
      })
      .finally(() => {
        if (current.current === pending) {
          current.current = null;
          if (alive.current) {
            setBusy(false);
            setStopping(false);
          }
        }
        void onSettled();
      });
  }
  async function stop() {
    const pending = current.current;
    if (!pending || stopping) return;
    setStopping(true);
    try {
      await cancelExtension(pending.id, pending.generation);
    } catch (reason) {
      if (alive.current) {
        setError(reason);
        setStopping(false);
      }
    }
  }
  function chooseFiles() {
    if (locked || selection.current || !item) return;
    const selectedItem = item;
    setPicking(true);
    setError(null);
    const pending = pickExtensionFiles()
      .then((documents) => {
        if (
          !documents.length ||
          !alive.current ||
          !latestItems.current.some(
            (installed) =>
              installed.package.manifest.id ===
                selectedItem.package.manifest.id &&
              installed.generation === selectedItem.generation,
          )
        )
          return;
        if (
          documents.length > 16 ||
          documents.reduce((sum, file) => sum + (file.bytes ?? Infinity), 0) >
            2 * 1024 * 1024
        )
          throw new NativeBridgeError({
            code: "INVALID_ARGUMENT",
            message: "Select at most sixteen files totaling 2 MiB",
            retryable: false,
          });
        latestFiles.current = documents.map(({ id, name }) => ({ id, name }));
        setFiles(latestFiles.current);
        setDirty(true);
      })
      .catch((reason: unknown) => {
        if (alive.current) setError(reason);
      })
      .finally(() => {
        if (selection.current === pending) selection.current = null;
        if (alive.current) setPicking(false);
      });
    selection.current = pending;
  }
  const runStatus = showProgress
    ? t(
        stopping
          ? "ext.stopping"
          : phase === "queued"
            ? "ext.queued"
            : "ext.running",
        { id: current.current?.id ?? "" },
      )
    : "";
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5"
      aria-label={t("ext.runner")}
    >
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{t("ext.runner")}</h3>
        <ExtensionHelp label={t("ext.runner")}>
          {t("ext.sessionHint")}
        </ExtensionHelp>
      </div>
      {choices.length ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-extension`}>{t("ext.choose")}</Label>
          <Select
            value={choice?.key ?? ""}
            disabled={locked}
            onValueChange={(key) => {
              if (key === choice?.key) return;
              if (dirty) setNextSelected(key);
              else selectCommand(key);
            }}
          >
            <SelectTrigger
              data-operation-locked={locked}
              ref={selector}
              id={`${id}-extension`}
              className={`w-full ${LOCKED_CONTROL_CLASS}`}
            >
              <SelectValue placeholder={t("ext.choose")} />
            </SelectTrigger>
            <SelectContent position="popper">
              {choices.map((value) => (
                <SelectItem key={value.key} value={value.key}>
                  {value.item.package.manifest.name} · {value.command.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ext.noEnabled")}</p>
      )}
      {hasText ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-input`}>{t("ext.input")}</Label>
          <Textarea
            id={`${id}-input`}
            rows={5}

            disabled={locked}
            data-operation-locked={locked}
            className={LOCKED_INPUT_CLASS}
            value={input}
            aria-invalid={tooLong}
            aria-describedby={tooLong ? `${id}-input-error` : undefined}
            aria-description={t("ext.inputHint")}
            placeholder={t("ext.inputHint")}
            onChange={(event) => {
              setInput(event.target.value);
              setDirty(true);
            }}
          />
          {tooLong ? (
            <p
              id={`${id}-input-error`}
              role="alert"
              className="text-xs text-destructive"
            >
              {t("ext.inputTooLong")}
            </p>
          ) : null}
        </div>
      ) : null}
      {hasFiles ? (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={locked}
            data-operation-locked={locked}
            className={LOCKED_CONTROL_CLASS}
            onClick={() => void chooseFiles()}
          >
            {t("ext.files")}
          </Button>
          <ExtensionHelp label={t("ext.files")}>
            {t("ext.filesHint")}
          </ExtensionHelp>
          {files.length ? (
            <>
              <ul className="list-inside list-disc text-sm">
                {files.map((file) => (
                  <li key={file.id} className="break-all">
                    {file.name}
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                data-operation-locked={locked}
                className={LOCKED_CONTROL_CLASS}
                onClick={() => {
                  latestFiles.current = [];
                  setFiles([]);
                  setDirty(true);
                }}
              >
                {t("ext.clearFiles")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {hasNetwork ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-url`}>{t("ext.url")}</Label>
          <Input
            id={`${id}-url`}
            type="url"
            maxLength={4096}
            value={url}
            disabled={locked}
            data-operation-locked={locked}
            className={LOCKED_INPUT_CLASS}
            onChange={(event) => {
              setUrl(event.target.value);
              setDirty(true);
            }}
            aria-description={t("ext.urlHint")}
            placeholder={t("ext.urlHint")}
          />
          <ExtensionHelp label={t("ext.allowedHosts")}>
            {item
              ? extensionNetworkOrigins(item).join(", ")
              : t("ext.noEnabled")}
          </ExtensionHelp>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!item || locked || (hasText && tooLong)}
          data-operation-locked={
            locked && Boolean(item) && !(hasText && tooLong)
          }
          className={LOCKED_CONTROL_CLASS}
          onClick={run}
        >
          {t("ext.run")}
        </Button>
        <Button
          variant="outline"
          disabled={locked || !dirty}
          data-operation-locked={locked && dirty}
          className={LOCKED_CONTROL_CLASS}
          onClick={() =>
            void save().catch((reason: unknown) => {
              if (alive.current) setError(reason);
            })
          }
        >
          {t("ext.export")}
        </Button>
        <Button
          variant="outline"
          disabled={!showProgress || !busy || stopping}
          aria-hidden={!showProgress}
          tabIndex={showProgress ? 0 : -1}
          style={{ visibility: showProgress ? undefined : "hidden" }}
          onClick={() => void stop()}
        >
          {t("ext.stop")}
        </Button>
      </div>
      <div className="space-y-2">
        <div className="flex h-5 min-w-0 items-center justify-between gap-3">
          <h4 className="min-w-0 flex-1 truncate text-sm font-medium">
            {t("ext.output")}
            {output ? ` · ${output.extensionId}` : ""}
          </h4>
          <TooltipProvider delayDuration={650}>
            <Tooltip>
              <TooltipTrigger asChild>
                <p
                  role="status"
                  aria-label={t("ext.appStatus")}
                  aria-atomic="true"
                  tabIndex={runStatus ? 0 : undefined}
                  className="max-w-[60%] truncate rounded-sm text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {runStatus}
                </p>
              </TooltipTrigger>
              <TooltipContent className="max-w-[min(18rem,var(--radix-tooltip-content-available-width))] break-words">
                {runStatus}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <ExtensionOutput
          text={output?.text ?? t("ext.noOutput")}
          format={output?.format ?? "text"}
        />
      </div>
      <Button
        variant="outline"
        disabled={locked || !output}
        data-operation-locked={locked}
        className={LOCKED_CONTROL_CLASS}
        onClick={() => {
          if (exportLock.current || !output) return;
          exportLock.current = true;
          setExporting(true);
          const suffix =
            output.format === "json"
              ? "json"
              : output.format === "markdown"
                ? "md"
                : "txt";
          // Manifest IDs are ASCII, while the native export name is limited to 100 bytes.
          const name = `${output.extensionId}-${output.commandId}`.slice(
            0,
            100 - suffix.length - 1,
          );
          void saveTextExport(`${name}.${suffix}`, output.text)
            .catch((reason: unknown) => {
              if (alive.current) setError(reason);
            })
            .finally(() => {
              exportLock.current = false;
              if (alive.current) setExporting(false);
            });
        }}
      >
        {t("ext.saveResult")}
      </Button>
      {item && choice ? (
        <ExtensionSessionImport
          key={choice.key}
          item={item}
          commandId={choice.command.id}
          kind="tool"
          blocked={locked}
          onError={(reason) => {
            if (alive.current) setError(reason);
          }}
          onPending={(pending, completed) => {
            if (pending !== null || selection.current === completed) {
              selection.current = pending;
              if (alive.current) setPicking(pending !== null);
            }
          }}
          onRestore={(imported) => {
            latestFiles.current = [];
            setFiles([]);
            setInput(imported.inputText);
            setUrl(imported.url);
            lastOutput.current = imported.result
              ? {
                  ...imported.result,
                  extensionId: imported.extensionId,
                  commandId: imported.commandId,
                }
              : null;
            setOutput(lastOutput.current);
            setDirty(true);
            setError(null);
          }}
        />
      ) : null}
      <Dialog
        open={nextSelected !== null}
        onOpenChange={(open) => {
          if (!open) setNextSelected(null);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            selector.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("ext.switchCommand")}</DialogTitle>
            <DialogDescription>{t("ext.switchCommandHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNextSelected(null)}>
              {t("ext.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (nextSelected) selectCommand(nextSelected);
              }}
            >
              {t("ext.switchCommand")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

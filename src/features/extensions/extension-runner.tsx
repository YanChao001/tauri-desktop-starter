import { ExtensionOutput } from "./extension-output";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  pickWorkbenchFiles,
  saveTextExport,
  NativeBridgeError,
  type ExtensionInfo,
  type ExtensionResultFormat,
  type WorkbenchDocument,
} from "@/lib/tauri";

type FileChoice = Pick<WorkbenchDocument, "id" | "name">;
type PendingRun = { id: string; done: Promise<void> };

export function ExtensionRunner({
  items,
  runningId,
  onSettled,
  requestedExtension = "",
  requestedCommand = "",
}: {
  requestedExtension?: string;
  requestedCommand?: string;
  items: ExtensionInfo[];
  runningId: string | null;
  onSettled: () => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [selected, setSelected] = useState("");
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
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [picking, setPicking] = useState(false);
  const alive = useRef(false);
  const appliedRequest = useRef("");
  const current = useRef<PendingRun | null>(null);
  const selection = useRef<Promise<void> | null>(null);
  const exportLock = useRef(false);
  const enabled = items.filter(
    (item) => item.enabled && item.package.manifest.resultFormat !== "view",
  );
  const choices = enabled.flatMap((item) =>
    item.package.manifest.commands.map((command) => ({
      item,
      command,
      key: item.package.manifest.id + ":" + command.id,
    })),
  );
  const choice =
    choices.find((value) => value.key === selected) ??
    (selected ? undefined : choices[0]);
  const item = choice?.item;
  const grants = item?.grantedPermissions ?? [];
  const hasText = grants.includes("text:read");
  const hasFiles = grants.includes("files:read");
  const hasNetwork = grants.includes("network:https");
  const tooLong = new TextEncoder().encode(input).length > 64 * 1024;
  const locked = busy || exporting || picking;
  useEffect(() => {
    // Navigation from the command palette does not overwrite an unsaved session.
    const key = requestedExtension + ":" + requestedCommand;
    if (
      !requestedExtension ||
      !requestedCommand ||
      dirty ||
      current.current ||
      appliedRequest.current === key
    )
      return;
    appliedRequest.current = key;
    setSelected(key);
  }, [requestedExtension, requestedCommand, dirty]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current.current)
        void cancelExtension(current.current.id).catch(() => {});
    };
  }, []);
  async function settle(signal?: AbortSignal) {
    signal?.throwIfAborted();
    await selection.current;
    signal?.throwIfAborted();
    const pending = current.current;
    if (pending) {
      await cancelExtension(pending.id);
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
      const content = JSON.stringify(
        {
          extensionId: item?.package.manifest.id ?? selected,
          commandId: choice?.command.id,
          inputText: input,
          files: latestFiles.current.map((file) => file.name),
          url,
          result: lastOutput.current,
        },
        null,
        2,
      );
      signal?.throwIfAborted();
      const saved = await saveTextExport("extension-session.json", content);
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
      runningId ||
      (hasText && tooLong)
    )
      return;
    const extensionId = item.package.manifest.id;
    setBusy(true);
    setStopping(false);
    setError(null);
    const pending: PendingRun = { id: extensionId, done: Promise.resolve() };
    current.current = pending;
    pending.done = runExtension({
      id: extensionId,
      commandId: choice.command.id,
      expectedSha256: item.package.sha256,
      inputText: hasText ? input : "",
      fileIds: hasFiles ? files.map((file) => file.id) : [],
      url: hasNetwork && url.trim() ? url.trim() : null,
    })
      .then((text) => {
        lastOutput.current = {
          extensionId,
          commandId: choice.command.id,
          format: item.package.manifest.resultFormat,
          text,
        };
        if (alive.current) {
          setOutput(lastOutput.current);
          setDirty(true);
        }
      })
      .catch((reason: unknown) => {
        if (alive.current) setError(reason);
      })
      .finally(() => {
        if (current.current === pending) current.current = null;
        if (alive.current) {
          setBusy(false);
          setStopping(false);
          void onSettled();
        }
      });
  }
  async function stop() {
    const pending = current.current;
    if (!pending || stopping) return;
    setStopping(true);
    try {
      await cancelExtension(pending.id);
    } catch (reason) {
      if (alive.current) {
        setError(reason);
        setStopping(false);
      }
    }
  }
  function chooseFiles() {
    if (locked || selection.current) return;
    setPicking(true);
    setError(null);
    const pending = pickWorkbenchFiles()
      .then((documents) => {
        if (!documents.length || !alive.current) return;
        if (
          documents.length > 3 ||
          documents.some(
            (file) => file.content === null || file.bytes === null,
          ) ||
          documents.reduce((sum, file) => sum + (file.bytes ?? Infinity), 0) >
            64 * 1024
        )
          throw new NativeBridgeError({
            code: "INVALID_ARGUMENT",
            message: "Select at most three text files totaling 64 KiB",
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
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5"
      aria-label={t("ext.runner")}
    >
      <h3 className="font-semibold">{t("ext.runner")}</h3>
      <p className="text-sm text-muted-foreground">{t("ext.runHint")}</p>
      {enabled.length ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-extension`}>{t("ext.choose")}</Label>
          <Select
            value={choice?.key ?? ""}
            disabled={locked}
            onValueChange={setSelected}
          >
            <SelectTrigger id={`${id}-extension`} className="w-full">
              <SelectValue placeholder={t("ext.choose")} />
            </SelectTrigger>
            <SelectContent>
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
            maxLength={65536}
            disabled={locked}
            value={input}
            aria-invalid={tooLong}
            aria-describedby={`${id}-input-hint`}
            onChange={(event) => {
              setInput(event.target.value);
              setDirty(true);
            }}
          />
          <p id={`${id}-input-hint`} className="text-xs text-muted-foreground">
            {t("ext.inputHint")}
          </p>
        </div>
      ) : null}
      {hasFiles ? (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => void chooseFiles()}
          >
            {t("ext.files")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("ext.filesHint")}</p>
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
            maxLength={2048}
            value={url}
            disabled={locked}
            onChange={(event) => {
              setUrl(event.target.value);
              setDirty(true);
            }}
            aria-describedby={`${id}-url-hint`}
          />
          <p className="text-xs">
            {t("ext.allowedHosts")}:{" "}
            <code>{item?.package.manifest.allowedHosts?.join(", ")}</code>
          </p>
          <p id={`${id}-url-hint`} className="text-xs text-muted-foreground">
            {t("ext.urlHint")}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            !item || locked || runningId !== null || (hasText && tooLong)
          }
          onClick={run}
        >
          {t("ext.run")}
        </Button>
        {busy ? (
          <Button
            variant="outline"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {t(stopping ? "ext.stopping" : "ext.stop")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={locked || !dirty}
          onClick={() =>
            void save().catch((reason: unknown) => {
              if (alive.current) setError(reason);
            })
          }
        >
          {t("ext.export")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {nativeErrorText(error, t)}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm">
          {t(stopping ? "ext.stopping" : "ext.running", {
            id: current.current?.id ?? "",
          })}
        </p>
      ) : null}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">
          {t("ext.output")}
          {output ? ` · ${output.extensionId}` : ""}
        </h4>
        <ExtensionOutput
          text={output?.text ?? t("ext.noOutput")}
          format={output?.format ?? "text"}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("ext.sessionHint")}</p>
    </section>
  );
}

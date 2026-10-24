import { useEffect, useId, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/providers/i18n";
import { nativeErrorText } from "@/lib/native-error";
import {
  pickExtensionFiles,
  type ExtensionInfo,
  type ExtensionViewDataInput,
} from "@/lib/tauri";
import { extensionNetworkOrigins } from "./extension-model";
import type { ExtensionSession } from "./extensions-provider";
import { LOCKED_CONTROL_CLASS, LOCKED_INPUT_CLASS } from "./control-styles";

export function ExtensionData({
  item,
  blocked,
  session,
  onDirty,
  onPickingChange,
  onSend,
}: {
  item: ExtensionInfo;
  blocked: boolean;
  session: ExtensionSession;
  onDirty: () => void;
  onPickingChange: (picking: boolean) => void;
  onSend: (input: ExtensionViewDataInput) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const { inputText, url, files } = session.draft;
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const [picking, setPicking] = useState(session.selecting !== null);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    let stopped = false;
    if (session.selecting)
      void session.selecting.then(() => {
        if (!stopped) setPicking(false);
      });
    return () => {
      stopped = true;
    };
  }, [session]);
  const grants = item.grantedPermissions;
  const hasText = grants.includes("text:read");
  const hasFiles = grants.includes("files:read");
  const hasNetwork =
    grants.includes("network:https") || grants.includes("network:local");
  if (!hasText && !hasFiles && !hasNetwork) return null;
  const tooLong =
    hasText && new TextEncoder().encode(inputText).length > 1024 * 1024;
  const hasData = Boolean(
    (hasText && inputText) ||
    (hasFiles && files.length) ||
    (hasNetwork && url.trim()),
  );
  function draft(patch: Partial<ExtensionSession["draft"]>) {
    session.draft = { ...session.draft, ...patch };
    refresh();
    session.dirty = true;
    onDirty();
  }
  return (
    <details className="min-w-0 rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("ext.hostData")}
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{t("ext.hostDataHint")}</p>
        {hasText ? (
          <div className="space-y-2">
            <Label htmlFor={`${id}-text`}>{t("ext.input")}</Label>
            <Textarea
              id={`${id}-text`}
              value={inputText}
              disabled={blocked}
              data-operation-locked={blocked}
              className={LOCKED_INPUT_CLASS}
              onChange={(e) => {
                draft({ inputText: e.target.value });
              }}

              aria-invalid={tooLong}
            />
            <p className="text-xs text-muted-foreground">
              {t("ext.inputHint")}
            </p>
          </div>
        ) : null}
        {hasFiles ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={blocked || picking}
                data-operation-locked={blocked || picking}
                className={LOCKED_CONTROL_CLASS}
                onClick={() => {
                  if (blocked || session.selecting) return;
                  const request = ++generation.current;
                  setPicking(true);
                  onPickingChange(true);
                  setError(null);
                  const selecting = pickExtensionFiles()
                    .then((result) => {
                      if (request !== generation.current) return;
                      if (!result.length) return;
                      if (
                        result.length > 16 ||
                        result.reduce(
                          (sum, file) => sum + (file.bytes ?? Infinity),
                          0,
                        ) >
                          2 * 1024 * 1024
                      )
                        throw new Error(t("ext.filesHint"));
                      const files = result.map(({ id, name }) => ({
                        id,
                        name,
                      }));
                      draft({ files });
                    })
                    .catch((reason: unknown) => {
                      if (request === generation.current) setError(reason);
                    })
                    .finally(() => {
                      if (session.selecting === selecting)
                        session.selecting = null;
                      if (request === generation.current) {
                        setPicking(false);
                        onPickingChange(false);
                      }
                    });
                  session.selecting = selecting;
                }}
              >
                {t("ext.files")}
              </Button>
              <Button
                variant="ghost"
                disabled={blocked || !files.length}
                data-operation-locked={blocked && files.length > 0}
                className={LOCKED_CONTROL_CLASS}
                onClick={() => {
                  draft({ files: [] });
                }}
              >
                {t("ext.clearFiles")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("ext.filesHint")}
            </p>
            {files.length ? (
              <ul className="space-y-1 text-sm">
                {files.map((file) => (
                  <li className="break-all" key={file.id}>
                    {file.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {hasNetwork ? (
          <div className="space-y-2">
            <Label htmlFor={`${id}-url`}>{t("ext.url")}</Label>
            <Input
              id={`${id}-url`}
              type="url"
              value={url}
              disabled={blocked}
              data-operation-locked={blocked}
              className={LOCKED_INPUT_CLASS}
              maxLength={4096}
              onChange={(e) => {
                draft({ url: e.target.value });
              }}
              placeholder={`${extensionNetworkOrigins(item)[0] ?? "https://example.com"}/`}
            />
            <p className="break-words text-xs text-muted-foreground">
              {t("ext.allowedHosts")}:{" "}
              {extensionNetworkOrigins(item).join(", ")}. {t("ext.urlHint")}
            </p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {nativeErrorText(error, t)}
          </p>
        ) : null}
        <Button
          className={LOCKED_CONTROL_CLASS}
          data-operation-locked={(blocked || picking) && !tooLong && hasData}
          disabled={blocked || picking || tooLong || !hasData}
          onClick={() =>
            onSend({
              inputText: hasText ? inputText : "",
              fileIds: hasFiles ? files.map((file) => file.id) : [],
              url: hasNetwork ? url.trim() || null : null,
            })
          }
        >
          {t("ext.sendData")}
        </Button>
      </div>
    </details>
  );
}

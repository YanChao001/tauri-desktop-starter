import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import type {
  ExtensionSession,
  ExtensionSessionState,
} from "./extension-session-cache";
import { LOCKED_CONTROL_CLASS, LOCKED_INPUT_CLASS } from "./control-styles";
import { ExtensionHelp } from "./extension-help";
import { useExtensionActivity } from "./extension-activity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ExtensionData({
  item,
  blocked,
  session,
  onSend,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  item: ExtensionInfo;
  blocked: boolean;
  session: ExtensionSession;
  onSend: (input: ExtensionViewDataInput) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const active = useExtensionActivity();
  const activity = useRef(active);
  activity.current = active;
  const id = useId();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { inputText, url, files } = state.draft;
  const picking = state.selecting !== null;
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (error)
      toast.error(nativeErrorText(error, t), { id: `extension-data:${id}` });
  }, [error, t, id]);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
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
  function draft(patch: Partial<ExtensionSessionState["draft"]>) {
    session.update({
      draft: { ...session.getSnapshot().draft, ...patch },
      dirty: true,
    });
  }
  const content = (
    <div className="min-w-0 space-y-3">
      {hasText ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${id}-text`}>{t("ext.input")}</Label>
            <ExtensionHelp
              label={t("ext.input")}
            >{`${t("ext.hostDataHint")} ${t("ext.inputHint")}`}</ExtensionHelp>
          </div>
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
            aria-describedby={tooLong ? `${id}-text-error` : undefined}
            aria-description={t("ext.inputHint")}
          />
          {tooLong ? (
            <p
              id={`${id}-text-error`}
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={blocked || picking}
              data-operation-locked={blocked || picking}
              className={LOCKED_CONTROL_CLASS}
              aria-description={t("ext.filesHint")}
              onClick={() => {
                if (blocked || session.getSnapshot().selecting) return;
                const request = ++generation.current;
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
                    if (session.getSnapshot().selecting === selecting)
                      session.update({ selecting: null });
                  });
                session.update({ selecting });
              }}
            >
              {t("ext.files")}
            </Button>
            <ExtensionHelp
              label={t("ext.files")}
            >{`${t("ext.hostDataHint")} ${t("ext.filesHint")}`}</ExtensionHelp>
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
          <div className="flex items-center gap-1">
            <Label htmlFor={`${id}-url`}>{t("ext.url")}</Label>
            <ExtensionHelp
              label={t("ext.url")}
            >{`${t("ext.allowedHosts")}: ${extensionNetworkOrigins(item).join(", ")}. ${t("ext.urlHint")}`}</ExtensionHelp>
          </div>
          <Input
            id={`${id}-url`}
            type="url"
            value={url}
            disabled={blocked}
            data-operation-locked={blocked}
            className={LOCKED_INPUT_CLASS}
            maxLength={4096}
            aria-description={`${t("ext.allowedHosts")}: ${extensionNetworkOrigins(item).join(", ")}. ${t("ext.urlHint")}`}
            onChange={(e) => {
              draft({ url: e.target.value });
            }}
            placeholder={`${extensionNetworkOrigins(item)[0] ?? "https://example.com"}/`}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="sr-only">
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
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("common.close")}
        onOpenAutoFocus={(event) => {
          if (!(event.target instanceof HTMLElement)) return;
          const field = event.target.querySelector<HTMLElement>(
            "textarea:not(:disabled),input:not(:disabled),button:not([data-extension-help]):not(:disabled)",
          );
          if (field) {
            event.preventDefault();
            field.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocusRef) {
            event.preventDefault();
            // 关闭回调可能晚于导航或缓存页恢复；保留用户已选择的新焦点。
            if (!activity.current || document.activeElement !== document.body)
              return;
            returnFocusRef.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("ext.sendDataTitle")}</DialogTitle>
          <DialogDescription>{t("ext.hostDataHint")}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

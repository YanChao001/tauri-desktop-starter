import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import type { ExtensionInfo } from "@/lib/tauri";
import {
  EXTENSION_SESSION_BYTES,
  parseExtensionSession,
  type ExtensionSessionExport,
} from "./extension-session";

export function ExtensionSessionImport({
  item,
  commandId,
  kind,
  blocked,
  onRestore,
  onError,
  onPending,
}: {
  item: ExtensionInfo;
  commandId: string;
  kind: "view" | "tool";
  blocked: boolean;
  onRestore: (value: ExtensionSessionExport) => void;
  onError: (error: unknown) => void;
  onPending: (promise: Promise<void> | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<ExtensionSessionExport | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-session`}>{t("ext.importSession")}</Label>
      <Input
        ref={input}
        id={`${id}-session`}
        type="file"
        accept=".json,application/json"
        disabled={blocked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || blocked || pending.current) return;
          pending.current = true;
          const request = generation.current;
          const parsing = (async () => {
            if (file.size > EXTENSION_SESSION_BYTES)
              throw new Error(t("ext.sessionInvalid"));
            const content = new TextDecoder("utf-8", { fatal: true }).decode(
              await file.arrayBuffer(),
            );
            const session = await parseExtensionSession(
              content,
              item,
              commandId,
              kind,
            );
            if (generation.current === request) setReview(session);
          })()
            .catch((reason: unknown) => {
              if (generation.current === request)
                onError(new Error(t("ext.sessionInvalid"), { cause: reason }));
            })
            .finally(() => {
              pending.current = false;
              onPending(null);
            });
          onPending(parsing);
        }}
      />
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("ext.importSession")}</DialogTitle>
            <DialogDescription>{t("ext.importSessionHint")}</DialogDescription>
          </DialogHeader>
          {review?.files.length ? (
            <p className="text-sm text-muted-foreground">
              {t("ext.importFileHint")} {review.files.join(", ")}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>
              {t("ext.cancel")}
            </Button>
            <Button
              disabled={blocked || !review}
              onClick={() => {
                if (review) {
                  onRestore(review);
                  setReview(null);
                }
              }}
            >
              {t("ext.replaceSession")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

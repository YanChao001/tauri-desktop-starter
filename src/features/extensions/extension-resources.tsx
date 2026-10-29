import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { InfoIcon } from "lucide-react";
import { HelpTooltip } from "@/components/help-tooltip";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/providers/i18n";
import { nativeErrorText } from "@/lib/native-error";
import { isRecord } from "@/lib/settings-model";
import {
  extensionStorageInfo,
  clearExtensionStorage,
  extensionCredentialSlots,
  setExtensionCredential,
  deleteExtensionCredential,
  type ExtensionInfo,
} from "@/lib/tauri";

/** User-managed secrets never enter extension fields or a session export. */
export function ExtensionResources({ item }: { item: ExtensionInfo }) {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const id = useId();
  const manifest = item.package.manifest;
  const [storage, setStorage] = useState<Awaited<
    ReturnType<typeof extensionStorageInfo>
  > | null>(null);
  const [slots, setSlots] = useState<
    Awaited<ReturnType<typeof extensionCredentialSlots>>
  >([]);
  const [origin, setOrigin] = useState(manifest.network[0]?.origin ?? "");
  const [alias, setAlias] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [storageError, setStorageError] = useState<unknown>(null);
  const [credentialsError, setCredentialsError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<
    (typeof slots)[number] | null
  >(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const hasStorage = [
    ...manifest.permissions,
    ...manifest.optionalPermissions,
  ].includes("storage");
  const hasNetwork = manifest.network.length > 0;
  const extensionId = manifest.id;
  const expectedSha256 = item.package.sha256;
  const expectedGeneration = item.generation;
  const load = useCallback(async () => {
    if (!alive.current) return;
    const request = ++generation.current;
    setLoading(true);
    const [nextStorage, nextSlots] = await Promise.allSettled([
      hasStorage
        ? extensionStorageInfo(extensionId, expectedSha256, expectedGeneration)
        : null,
      hasNetwork
        ? extensionCredentialSlots(
            extensionId,
            expectedSha256,
            expectedGeneration,
          )
        : [],
    ]);
    if (!alive.current || generation.current !== request) return;
    if (nextStorage.status === "fulfilled") setStorage(nextStorage.value);
    if (nextSlots.status === "fulfilled") setSlots(nextSlots.value);
    setStorageError(
      nextStorage.status === "rejected" ? nextStorage.reason : null,
    );
    setCredentialsError(
      nextSlots.status === "rejected" ? nextSlots.reason : null,
    );
    const failure =
      nextStorage.status === "rejected"
        ? nextStorage.reason
        : nextSlots.status === "rejected"
          ? nextSlots.reason
          : null;
    setLoading(false);
    if (failure) toast.error(nativeErrorText(failure, latest));
  }, [
    extensionId,
    expectedSha256,
    expectedGeneration,
    hasStorage,
    hasNetwork,
    latest,
  ]);
  useEffect(() => {
    alive.current = true;
    void load().catch((reason: unknown) => {
      if (alive.current) {
        setLoading(false);
        if (hasStorage) setStorageError(reason);
        if (hasNetwork) setCredentialsError(reason);
        toast.error(nativeErrorText(reason, latest));
      }
    });
    return () => {
      alive.current = false;
    };
  }, [load, latest, hasStorage, hasNetwork]);
  async function act(action: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (reason) {
      if (alive.current) {
        setError(reason);
        toast.error(nativeErrorText(reason, latest));
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const storageStatusText = storage
    ? t("ext.storageUsage", { entries: storage.entries, bytes: storage.bytes })
    : loading
      ? t("common.loading")
      : storageError
        ? ""
        : t("ext.noOutput");
  return (
    <div className="min-w-0 space-y-3">
      {hasStorage ? (
        <fieldset className="min-w-0 space-y-3" aria-label={t("ext.storage")}>
          <legend className="max-w-full text-sm font-medium">
            <h4 className="inline-flex items-center gap-2 text-sm font-medium">
              {t("ext.storage")}
              <HelpTooltip label={`${t("ext.storage")} · ${t("title.help")}`}>
                {t("ext.storageHint")}
              </HelpTooltip>
            </h4>
          </legend>
          <div
            role="status"
            aria-label={t("ext.storage")}
            className="flex min-h-5 min-w-0 items-center gap-2 text-sm text-muted-foreground"
          >
            <TooltipProvider delayDuration={650}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={storageStatusText ? 0 : undefined}
                    className="truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {storageStatusText}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[min(18rem,var(--radix-tooltip-content-available-width))] break-words">
                  {storageStatusText}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {storageError ? <ReadFailure error={storageError} /> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || loading}
              onClick={() => void act(async () => {})}
            >
              {t("common.refresh")}
            </Button>
            <Dialog open={confirm} onOpenChange={setConfirm}>
              <DialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy || !storage}
                >
                  {t("ext.clearStorage")}
                </Button>
              </DialogTrigger>
              <DialogContent closeLabel={t("common.close")}>
                <DialogHeader>
                  <DialogTitle>{t("ext.clearStorage")}</DialogTitle>
                  <DialogDescription>
                    {t("ext.clearStorageHint")}
                  </DialogDescription>
                </DialogHeader>
                {error ? (
                  <p role="alert" className="sr-only">
                    {nativeErrorText(error, t)}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirm(false)}
                  >
                    {t("ext.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || !storage}
                    onClick={() =>
                      void act(async () => {
                        if (!storage) return;
                        await clearExtensionStorage(
                          manifest.id,
                          item.package.sha256,
                          item.generation,
                          storage.revision,
                        );
                        if (alive.current) setConfirm(false);
                      })
                    }
                  >
                    {t("ext.clearStorage")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </fieldset>
      ) : null}
      {manifest.network.length ? (
        <form
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (!origin || !alias.trim() || !secret) return;
            void act(async () => {
              await setExtensionCredential(
                manifest.id,
                item.package.sha256,
                item.generation,
                origin,
                alias.trim(),
                secret,
              );
              if (alive.current) setSecret("");
            });
          }}
        >
          <fieldset
            className="min-w-0 space-y-3"
            aria-label={t("ext.credentials")}
          >
            <legend className="max-w-full text-sm font-medium">
              <h4 className="inline-flex items-center gap-2 text-sm font-medium">
                {t("ext.credentials")}
                <HelpTooltip
                  label={`${t("ext.credentials")} · ${t("title.help")}`}
                >
                  {t("ext.credentialsHint")}
                </HelpTooltip>
              </h4>
            </legend>
            <div
              role="status"
              aria-label={t("ext.credentials")}
              className="flex min-w-0 items-center text-sm text-muted-foreground empty:hidden"
            >
              {credentialsError ? (
                <ReadFailure error={credentialsError} />
              ) : loading ? (
                <span className="truncate">{t("common.loading")}</span>
              ) : null}
            </div>
            {slots.map((slot) => (
              <div
                key={`${slot.origin}:${slot.alias}`}
                className="flex min-w-0 items-center justify-between gap-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate">
                    {slot.alias} · {slot.origin}
                  </span>
                  <HelpTooltip
                    label={`${slot.alias} · ${t("title.help")}`}
                    className="shrink-0"
                  >
                    <span className="break-all select-text">
                      {slot.alias} · {slot.origin}
                    </span>
                  </HelpTooltip>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="shrink-0"
                  disabled={busy}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setError(null);
                    setCredentialToDelete(slot);
                  }}
                  aria-label={t("ext.deleteCredentialNamed", {
                    alias: slot.alias,
                  })}
                >
                  {t("ext.deleteCredential")}
                </Button>
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor={`${id}-origin`}>
                {t("ext.credentialOrigin")}
              </Label>
              <Select value={origin} onValueChange={setOrigin} disabled={busy}>
                <SelectTrigger id={`${id}-origin`} className="w-full min-w-0">
                  <SelectValue className="min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {manifest.network.map((rule) => (
                    <SelectItem key={rule.origin} value={rule.origin}>
                      {rule.origin}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-alias`}>{t("ext.credentialAlias")}</Label>
              <Input
                id={`${id}-alias`}
                value={alias}
                maxLength={64}
                pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
                disabled={busy}
                onChange={(event) => setAlias(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-secret`}>
                {t("ext.credentialSecret")}
              </Label>
              <Input
                id={`${id}-secret`}
                type="password"
                autoComplete="new-password"
                value={secret}
                maxLength={8192}
                disabled={busy}
                onChange={(event) => setSecret(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || !alias.trim() || !secret}
              >
                {t("ext.saveCredential")}
              </Button>
              {!hasStorage ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => void act(async () => {})}
                >
                  {t("common.refresh")}
                </Button>
              ) : null}
            </div>
          </fieldset>
        </form>
      ) : null}
      <Dialog
        open={credentialToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setCredentialToDelete(null);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = deleteTrigger.current;
            if (target?.isConnected) target.focus();
            else document.getElementById(`${id}-origin`)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("ext.deleteCredential")}</DialogTitle>
            <DialogDescription className="break-words">
              {credentialToDelete
                ? t("ext.deleteCredentialHint", credentialToDelete)
                : ""}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {nativeErrorText(error, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setCredentialToDelete(null)}
            >
              {t("ext.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !credentialToDelete}
              onClick={() => {
                if (!credentialToDelete) return;
                const slot = credentialToDelete;
                void act(() =>
                  deleteExtensionCredential(
                    manifest.id,
                    item.package.sha256,
                    item.generation,
                    slot.origin,
                    slot.alias,
                  ),
                ).then((completed) => {
                  if (completed && alive.current) setCredentialToDelete(null);
                });
              }}
            >
              {t("ext.deleteCredential")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && !confirm && !credentialToDelete ? (
        <p role="alert" className="sr-only">
          {nativeErrorText(error, t)}
        </p>
      ) : null}
    </div>
  );
}

function ReadFailure({ error }: { error: unknown }) {
  const { t } = useI18n();
  const text = nativeErrorText(error, t);
  const detail =
    isRecord(error) &&
    typeof error.message === "string" &&
    !text.includes(error.message)
      ? error.message
      : null;
  return (
    <div
      role="alert"
      className="flex min-w-0 flex-1 items-center gap-1 text-destructive"
    >
      <p className="min-w-0 flex-1 truncate">
        {text}
        {detail ? ` ${detail}` : ""}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={t("common.details")}
          >
            <InfoIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={t("common.details")}
          tabIndex={0}
          className="max-h-[min(18rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-2rem)] overflow-auto whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p>{text}</p>
          {detail ? <p>{detail}</p> : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

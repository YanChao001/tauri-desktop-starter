import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (reason) {
      if (alive.current) {
        setError(reason);
        toast.error(nativeErrorText(reason, latest));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4 border-t pt-4">
      {hasStorage ? (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 font-medium">
            {t("ext.storage")}
            <HelpTooltip label={`${t("ext.storage")} · ${t("title.help")}`}>
              {t("ext.storageHint")}
            </HelpTooltip>
          </h4>
          <div
            role="status"
            aria-label={t("ext.storage")}
            tabIndex={storageError ? 0 : undefined}
            className="h-12 overflow-auto text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {storage
              ? t("ext.storageUsage", {
                  entries: storage.entries,
                  bytes: storage.bytes,
                })
              : loading
                ? t("common.loading")
                : storageError
                  ? null
                  : t("ext.noOutput")}
            {storageError ? <ReadFailure error={storageError} /> : null}
          </div>
          <div className="flex gap-2">
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
              <DialogContent>
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
        </div>
      ) : null}
      {manifest.network.length ? (
        <form
          className="space-y-3"
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
          <div className="flex items-center gap-2">
            <h4 className="font-medium">{t("ext.credentials")}</h4>
            <HelpTooltip label={`${t("ext.credentials")} · ${t("title.help")}`}>
              {t("ext.credentialsHint")}
            </HelpTooltip>
            {!hasStorage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={busy || loading}
                onClick={() => void act(async () => {})}
              >
                {t("common.refresh")}
              </Button>
            ) : null}
          </div>
          <div
            role="status"
            aria-label={t("ext.credentials")}
            tabIndex={credentialsError ? 0 : undefined}
            className="h-12 overflow-auto text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {credentialsError ? (
              <ReadFailure error={credentialsError} />
            ) : loading ? (
              t("common.loading")
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
                variant="outline"
                className="shrink-0"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    deleteExtensionCredential(
                      manifest.id,
                      item.package.sha256,
                      item.generation,
                      slot.origin,
                      slot.alias,
                    ),
                  )
                }
                aria-label={t("ext.deleteCredentialNamed", {
                  alias: slot.alias,
                })}
              >
                {t("ext.deleteCredential")}
              </Button>
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor={`${id}-origin`}>{t("ext.credentialOrigin")}</Label>
            <Select value={origin} onValueChange={setOrigin} disabled={busy}>
              <SelectTrigger id={`${id}-origin`} className="w-full min-w-0">
                <SelectValue className="min-w-0 truncate" />
              </SelectTrigger>
              <SelectContent>
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
            <Label htmlFor={`${id}-secret`}>{t("ext.credentialSecret")}</Label>
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
          <Button variant="outline" disabled={busy || !alias.trim() || !secret}>
            {t("ext.saveCredential")}
          </Button>
        </form>
      ) : null}
      {error && !confirm ? (
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
      className="whitespace-pre-wrap break-words text-destructive"
    >
      <p>{text}</p>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const [error, setError] = useState<unknown>(null);
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
    const request = ++generation.current;
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
    setError(
      nextStorage.status === "rejected"
        ? nextStorage.reason
        : nextSlots.status === "rejected"
          ? nextSlots.reason
          : null,
    );
  }, [extensionId, expectedSha256, expectedGeneration, hasStorage, hasNetwork]);
  useEffect(() => {
    alive.current = true;
    void load().catch((reason: unknown) => {
      if (alive.current) setError(reason);
    });
    return () => {
      alive.current = false;
    };
  }, [load]);
  async function act(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (reason) {
      if (alive.current) setError(reason);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4 border-t pt-4">
      {hasStorage ? (
        <div className="space-y-2">
          <h4 className="font-medium">{t("ext.storage")}</h4>
          <p className="text-xs text-muted-foreground">
            {t("ext.storageHint")}
          </p>
          {storage ? (
            <p className="text-sm">
              {t("ext.storageUsage", {
                entries: storage.entries,
                bytes: storage.bytes,
              })}
            </p>
          ) : (
            <p role="status">{t("common.loading")}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void act(async () => {})}
            >
              {t("ext.refresh")}
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
                  <p role="alert" className="text-sm text-destructive">
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
          <h4 className="font-medium">{t("ext.credentials")}</h4>
          <p className="text-xs text-muted-foreground">
            {t("ext.credentialsHint")}
          </p>
          {slots.map((slot) => (
            <div
              key={`${slot.origin}:${slot.alias}`}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="break-all">
                <code>{slot.alias}</code> · {slot.origin}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
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
              <SelectTrigger id={`${id}-origin`}>
                <SelectValue />
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
        <p role="alert" className="text-sm text-destructive">
          {nativeErrorText(error, t)}
        </p>
      ) : null}
    </div>
  );
}

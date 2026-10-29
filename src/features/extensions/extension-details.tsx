import { useI18n, type DictKey } from "@/providers/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type {
  ExtensionInfo,
  ExtensionPermission,
  ExtensionPreview,
} from "@/lib/tauri";

export const PERMISSION_LABELS: Record<ExtensionPermission, DictKey> = {
  "text:read": "ext.permission.text:read",
  "files:read": "ext.permission.files:read",
  "network:https": "ext.permission.network:https",
  "network:local": "ext.permission.network:local",
  "network:images": "ext.permission.network:images",
  "network:system-proxy": "ext.permission.network:system-proxy",
  "links:open": "ext.permission.links:open",
  "window:control": "ext.permission.window:control",
  storage: "ext.permission.storage",
  "messaging:lan": "ext.permission.messaging:lan",
  "wallpapers:manage": "ext.permission.wallpapers:manage",
};

export function ExtensionDetails({
  value,
  origin,
  showIdentity = true,
  grantedPermissions,
  consent,
}: {
  value: ExtensionPreview;
  origin?: ExtensionInfo["origin"];
  showIdentity?: boolean;
  grantedPermissions?: readonly ExtensionPermission[];
  consent?: {
    grants: ExtensionPermission[];
    disabled: boolean;
    onChange: (grants: ExtensionPermission[]) => void;
  };
}) {
  const { t } = useI18n();
  const manifest = value.manifest;
  const selectedOptionalCount = manifest.optionalPermissions.filter(
    (permission) => consent?.grants.includes(permission),
  ).length;
  const canConnect = [
    ...manifest.permissions,
    ...manifest.optionalPermissions,
  ].some(
    (permission) =>
      permission.startsWith("network:") || permission === "messaging:lan",
  );
  return (
    <div className="min-w-0 space-y-3 text-sm">
      {showIdentity ? (
        <div>
          <h3 className="font-semibold break-words">{manifest.name}</h3>
          <p className="mt-1 break-words text-muted-foreground">
            {manifest.description}
          </p>
        </div>
      ) : null}
      <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-[auto_1fr]">
        {[
          [t("ext.version"), manifest.version],
          [t("ext.author"), manifest.author],
          [
            t("ext.features"),
            manifest.commands.map((command) => command.title).join(" · "),
          ],
        ].map(([label, content]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{content}</dd>
          </div>
        ))}
      </dl>
      {origin ? (
        <div className="space-y-1">
          <h4 className="font-medium">{t("ext.source")}</h4>
          <p>
            {t(
              origin.kind === "market"
                ? "ext.source.market"
                : origin.kind === "bundled"
                  ? "ext.source.bundled"
                  : "ext.source.local",
            )}
          </p>
          <p className="leading-relaxed text-muted-foreground">
            {t(
              origin.kind === "market"
                ? "ext.source.marketHint"
                : origin.kind === "bundled"
                  ? "ext.source.bundledHint"
                  : "ext.source.localHint",
            )}
          </p>
        </div>
      ) : null}
      {canConnect ? (
        <p className="leading-relaxed text-muted-foreground">
          {t("ext.permissionScopeHint")}
        </p>
      ) : null}
      <div>
        <h4 className="font-medium">{t("ext.requiredPermissions")}</h4>
        {manifest.permissions.length ? (
          <ul className="mt-2 list-inside list-disc space-y-1">
            {manifest.permissions.map((permission) => (
              <li key={permission}>{t(PERMISSION_LABELS[permission])}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted-foreground">{t("ext.noPermissions")}</p>
        )}
      </div>
      {manifest.optionalPermissions.length ? (
        <fieldset className="min-w-0">
          <legend className="font-medium">
            {t("ext.optionalPermissions")}
          </legend>
          <p className="mt-1 text-muted-foreground">
            {t("ext.optionalPermissionsHint")}
          </p>
          {consent ? (
            <Label className="mt-2 items-start leading-6">
              <Checkbox
                className="mt-1"
                checked={
                  selectedOptionalCount === 0
                    ? false
                    : selectedOptionalCount ===
                        manifest.optionalPermissions.length
                      ? true
                      : "indeterminate"
                }
                disabled={consent.disabled}
                onCheckedChange={(checked) =>
                  consent.onChange(
                    checked === true
                      ? [
                          ...new Set([
                            ...consent.grants,
                            ...manifest.optionalPermissions,
                          ]),
                        ]
                      : consent.grants.filter(
                          (grant) =>
                            !manifest.optionalPermissions.includes(grant),
                        ),
                  )
                }
              />
              <span className="min-w-0">
                {t("ext.selectAllOptionalPermissions")}
              </span>
            </Label>
          ) : null}
          <ul className="mt-2 list-inside list-disc space-y-1">
            {manifest.optionalPermissions.map((permission) => (
              <li
                key={permission}
                className={consent ? "list-none" : undefined}
              >
                {consent ? (
                  <Label className="items-start leading-6">
                    <Checkbox
                      className="mt-1"
                      checked={consent.grants.includes(permission)}
                      disabled={consent.disabled}
                      onCheckedChange={(checked) =>
                        consent.onChange(
                          checked === true
                            ? [...new Set([...consent.grants, permission])]
                            : consent.grants.filter(
                                (grant) => grant !== permission,
                              ),
                        )
                      }
                    />
                    <span className="min-w-0">
                      {t(PERMISSION_LABELS[permission])}
                    </span>
                  </Label>
                ) : (
                  <span>
                    {t(PERMISSION_LABELS[permission])}
                    {grantedPermissions ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t(
                          grantedPermissions.includes(permission)
                            ? "ext.permissionAllowed"
                            : "ext.permissionNotAllowed",
                        )}
                      </span>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <details className="border-t pt-3">
        <summary className="cursor-pointer text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("ext.technicalInfo")}
        </summary>
        <div className="space-y-3 pt-3">
          <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-[auto_1fr]">
            {[
              [t("ext.identifier"), manifest.id],
              [t("ext.minHostVersion"), manifest.minHostVersion],
              [
                t("ext.technicalCommands"),
                manifest.commands
                  .map(
                    (command) =>
                      `${command.title} (${command.inputFormat} → ${command.resultFormat})`,
                  )
                  .join(", "),
              ],
            ].map(([label, content]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-all">{content}</dd>
              </div>
            ))}
          </dl>
          {origin?.kind === "market" ? (
            <div className="space-y-1">
              <h4 className="font-medium">{t("ext.source")}</h4>
              <p className="break-all">
                <code>{origin.source.repository}</code> ·{" "}
                {t("ext.market.revision", {
                  revision: origin.source.catalogRevision,
                })}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {t("ext.source.key")}{" "}
                <code>{origin.source.publicKeyFingerprint}</code>
              </p>
            </div>
          ) : null}
          {manifest.network.length ? (
            <div className="space-y-1">
              <h4 className="font-medium">{t("ext.allowedHosts")}</h4>
              {manifest.network.map((rule) => (
                <p key={rule.origin} className="break-all">
                  <code>{rule.origin}</code> · {rule.methods.join(", ")}
                </p>
              ))}
            </div>
          ) : null}
          <div>
            <p className="font-medium">{t("ext.hash")}</p>
            <code className="block break-all text-xs">{value.sha256}</code>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("ext.bytes", { bytes: value.bytes })} · {t("ext.hashHint")}
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

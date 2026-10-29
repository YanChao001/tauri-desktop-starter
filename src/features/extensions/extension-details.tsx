import { useId } from "react";
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

const PERMISSION_DESCRIPTIONS: Record<ExtensionPermission, DictKey> = {
  "text:read": "ext.permissionDescription.text:read",
  "files:read": "ext.permissionDescription.files:read",
  "network:https": "ext.permissionDescription.network:https",
  "network:local": "ext.permissionDescription.network:local",
  "network:images": "ext.permissionDescription.network:images",
  "network:system-proxy": "ext.permissionDescription.network:system-proxy",
  "links:open": "ext.permissionDescription.links:open",
  "window:control": "ext.permissionDescription.window:control",
  storage: "ext.permissionDescription.storage",
  "messaging:lan": "ext.permissionDescription.messaging:lan",
  "wallpapers:manage": "ext.permissionDescription.wallpapers:manage",
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
  const id = useId();
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
  const sourceLabel = origin
    ? t(
        origin.kind === "market"
          ? "ext.source.market"
          : origin.kind === "bundled"
            ? "ext.source.bundled"
            : "ext.source.local",
      )
    : null;
  return (
    <div className="min-w-0 space-y-3 text-sm leading-5">
      <div className="space-y-2">
        {showIdentity ? (
          <div className="space-y-1">
            <h3 className="text-sm leading-5 font-medium break-words">
              {manifest.name}
            </h3>
            {manifest.description ? (
              <p className="break-words text-muted-foreground">
                {manifest.description}
              </p>
            ) : null}
          </div>
        ) : null}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5">
          {[
            [t("ext.version"), manifest.version],
            [t("ext.author"), manifest.author],
            ...(sourceLabel ? [[t("ext.source"), sourceLabel]] : []),
          ].map(([label, content]) => (
            <div key={label} className="flex min-w-0 max-w-full gap-1.5">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{content}</dd>
            </div>
          ))}
        </dl>
        {origin ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {t(
              origin.kind === "market"
                ? "ext.source.marketHint"
                : origin.kind === "bundled"
                  ? "ext.source.bundledHint"
                  : "ext.source.localHint",
            )}
          </p>
        ) : null}
      </div>
      <fieldset>
        <legend>{t("ext.requiredPermissions")}</legend>
        {manifest.permissions.length ? (
          <ul className="space-y-2">
            {manifest.permissions.map((permission) => (
              <li key={permission} className="space-y-0.5">
                <p className="font-medium">
                  {t(PERMISSION_LABELS[permission])}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(PERMISSION_DESCRIPTIONS[permission])}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("ext.noPermissions")}
          </p>
        )}
      </fieldset>
      {manifest.optionalPermissions.length ? (
        <fieldset aria-labelledby={`${id}-optional`}>
          <legend className="max-w-full">
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
              <span id={`${id}-optional`}>{t("ext.optionalPermissions")}</span>
              {consent ? (
                <Label className="min-h-7 gap-1.5 text-xs leading-5 font-normal">
                  <Checkbox
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
                  <span>{t("ext.selectAllOptionalPermissions")}</span>
                </Label>
              ) : null}
            </span>
          </legend>
          <p className="mb-2 text-xs leading-5 text-muted-foreground">
            {t("ext.optionalPermissionsHint")}
          </p>
          <ul className="space-y-2">
            {manifest.optionalPermissions.map((permission) => {
              const permissionId = `${id}-${permission}`;
              return (
                <li
                  key={permission}
                  className={
                    consent
                      ? "grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-0.5"
                      : "space-y-0.5"
                  }
                >
                  {consent ? (
                    <>
                      <Checkbox
                        id={permissionId}
                        className="mt-0.5"
                        aria-describedby={`${permissionId}-description`}
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
                      <Label
                        htmlFor={permissionId}
                        className="min-w-0 leading-5"
                      >
                        {t(PERMISSION_LABELS[permission])}
                      </Label>
                    </>
                  ) : (
                    <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
                      <span>{t(PERMISSION_LABELS[permission])}</span>
                      {grantedPermissions ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {t(
                            grantedPermissions.includes(permission)
                              ? "ext.permissionAllowed"
                              : "ext.permissionNotAllowed",
                          )}
                        </span>
                      ) : null}
                    </p>
                  )}
                  <p
                    id={`${permissionId}-description`}
                    className={`${consent ? "col-start-2 " : ""}text-xs leading-5 text-muted-foreground`}
                  >
                    {t(PERMISSION_DESCRIPTIONS[permission])}
                  </p>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      {canConnect ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {t("ext.permissionScopeHint")}
        </p>
      ) : null}
      <details>
        <summary className="px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t("ext.technicalInfo")}
        </summary>
        <dl className="grid gap-3 border-t p-3">
          {[
            [t("ext.identifier"), manifest.id],
            [t("ext.minHostVersion"), manifest.minHostVersion],
            ...(manifest.commands.length
              ? [
                  [
                    t("ext.technicalCommands"),
                    manifest.commands
                      .map(
                        (command) =>
                          `${command.title} (${command.inputFormat} → ${command.resultFormat})`,
                      )
                      .join(", "),
                  ],
                ]
              : []),
            ...(origin?.kind === "market"
              ? [[t("ext.market.repository"), origin.source.repository]]
              : []),
            ...(manifest.network.length
              ? [
                  [
                    t("ext.allowedHosts"),
                    manifest.network
                      .map(
                        (rule) => `${rule.origin} · ${rule.methods.join(", ")}`,
                      )
                      .join("\n"),
                  ],
                ]
              : []),
          ].map(([label, content]) => (
            <div
              key={label}
              className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words whitespace-pre-line [overflow-wrap:anywhere]">
                {content}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

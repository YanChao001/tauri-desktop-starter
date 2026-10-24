import { useI18n, type DictKey } from "@/providers/i18n";
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
  storage: "ext.permission.storage",
};

export function ExtensionDetails({
  value,
  origin,
}: {
  value: ExtensionPreview;
  origin?: ExtensionInfo["origin"];
}) {
  const { t } = useI18n();
  const manifest = value.manifest;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="font-semibold break-words">{manifest.name}</h3>
        <p className="mt-1 break-words text-muted-foreground">
          {manifest.description}
        </p>
        <code className="text-xs break-all">{manifest.id}</code>
      </div>
      <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-[auto_1fr]">
        {[
          [t("ext.author"), manifest.author],
          [t("ext.version"), manifest.version],
          [t("ext.minHostVersion"), manifest.minHostVersion],
          [
            t("ext.commands"),
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
          {origin.kind === "market" ? (
            <>
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
            </>
          ) : null}
        </div>
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
        <div>
          <h4 className="font-medium">{t("ext.optionalPermissions")}</h4>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {manifest.optionalPermissions.map((permission) => (
              <li key={permission}>{t(PERMISSION_LABELS[permission])}</li>
            ))}
          </ul>
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
  );
}

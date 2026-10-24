import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ExternalLinkIcon, PuzzleIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { NativePage, ResourceError } from "@/components/native-page";
import { Button } from "@/components/ui/button";
import { ExtensionApp } from "@/features/extensions/extension-app";
import { ExtensionIcon } from "@/features/extensions/extension-icon";
import { useExtensions } from "@/features/extensions/extensions-provider";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { canRunExtensionCommand } from "@/features/extensions/extension-model";
import { closeWindow, openExtensionWindow } from "@/lib/tauri";

export function ExtensionPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { t } = useI18n();
  const { extensionId, commandId } = useParams();
  const { data, error, loading, reload } = useExtensions();
  const navigate = useNavigate();
  const [windowError, setWindowError] = useState<unknown>(null);
  const [opening, setOpening] = useState(false);
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (standalone && theme !== settings.theme) setTheme(settings.theme);
  }, [standalone, theme, settings.theme, setTheme]);
  const item = data?.items.find(
    (item) => item.enabled && item.package.manifest.id === extensionId,
  );
  const command = item?.package.manifest.commands.find(
    (command) =>
      command.id === commandId &&
      command.resultFormat === "view" &&
      item &&
      canRunExtensionCommand(item, command),
  );
  return (
    <NativePage
      title={item?.package.manifest.name ?? t("ext.title")}
      description={item?.package.manifest.description ?? t("ext.description")}
    >
      <ResourceError
        error={error ?? windowError}
        retry={() => {
          setWindowError(null);
          void reload();
        }}
      />
      {loading ? (
        <p role="status">{t("common.loading")}</p>
      ) : item && command ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground">
              <span className="rounded-xl bg-primary/10 p-3 text-primary">
                <ExtensionIcon name={item.package.manifest.icon} />
              </span>
              <span>
                {command.title} · v{item.package.manifest.version}
              </span>
            </div>
            {!standalone && command.ui?.window ? (
              <Button
                variant="outline"
                disabled={opening}
                onClick={() => {
                  setOpening(true);
                  setWindowError(null);
                  void openExtensionWindow(
                    item.package.manifest.id,
                    command.id,
                    item.package.sha256,
                  )
                    .catch((reason: unknown) => setWindowError(reason))
                    .finally(() => setOpening(false));
                }}
              >
                <ExternalLinkIcon className="size-4" />
                {t("ext.openWindow")}
              </Button>
            ) : null}
          </div>
          {standalone ? (
            <p className="text-xs text-muted-foreground">
              {t("ext.windowHint")}
            </p>
          ) : null}
          <ExtensionApp
            key={`${item.package.sha256}:${item.package.manifest.version}:${extensionId}:${commandId}`}
            item={item}
            commandId={command.id}
            runs={data?.runs ?? []}
            onSettled={reload}
            onClose={() => {
              if (standalone)
                void closeWindow().catch((reason: unknown) =>
                  setWindowError(reason),
                );
              else navigate("/extensions");
            }}
          />
        </>
      ) : !loading && !error ? (
        <div className="space-y-4 rounded-xl border border-dashed p-6">
          <PuzzleIcon className="size-8 text-muted-foreground" />
          <p>{t("ext.entryUnavailable")}</p>
          {standalone ? (
            <Button
              variant="outline"
              onClick={() => {
                void closeWindow().catch((reason: unknown) =>
                  setWindowError(reason),
                );
              }}
            >
              {t("common.close")}
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/extensions">{t("ext.title")}</Link>
            </Button>
          )}
        </div>
      ) : null}
    </NativePage>
  );
}
export default ExtensionPage;

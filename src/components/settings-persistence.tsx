import { AlertCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/providers/settings";
import { useI18n } from "@/providers/i18n";
export function SettingsPersistence({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { persistence, persistenceError, retrySave } = useSettings();
  const { t } = useI18n();
  if (compact && persistence !== "error") return null;
  const failed = persistence === "error";
  const busy = persistence === "loading" || persistence === "saving";
  if (!failed)
    return busy ? (
      <span role="status" className="sr-only">
        {t(
          persistence === "loading"
            ? "settings.persistenceLoading"
            : "settings.persistenceSaving",
        )}
      </span>
    ) : null;
  const text =
    persistenceError === "FUTURE_SETTINGS_VERSION"
      ? t("settings.persistenceFuture")
      : t("settings.persistenceError");
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
        {text}
      </span>
      {failed && persistenceError !== "FUTURE_SETTINGS_VERSION" ? (
        <Button variant="outline" size="sm" onClick={retrySave}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

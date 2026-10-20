import { CheckIcon, Loader2Icon, AlertCircleIcon } from "lucide-react";
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
  const text = failed
    ? persistenceError === "FUTURE_SETTINGS_VERSION"
      ? t("settings.persistenceFuture")
      : t("settings.persistenceError")
    : busy
      ? t(
          persistence === "loading"
            ? "settings.persistenceLoading"
            : "settings.persistenceSaving",
        )
      : t("settings.persistenceSaved");
  return (
    <div
      role={failed ? "alert" : "status"}
      className={`flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-xs ${failed ? "border-destructive/40" : "text-muted-foreground"}`}
    >
      <span className="flex items-center gap-2">
        {failed ? (
          <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
        ) : busy ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <CheckIcon className="size-3.5 shrink-0" />
        )}
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

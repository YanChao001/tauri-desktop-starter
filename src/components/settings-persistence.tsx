import { useEffect } from "react";
import { AlertCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/providers/settings";
import { useI18n } from "@/providers/i18n";
export function SettingsPersistence({
  compact = false,
  showFutureWarning = true,
}: {
  compact?: boolean;
  showFutureWarning?: boolean;
}) {
  const { persistence, persistenceError, retrySave } = useSettings();
  const { t } = useI18n();
  const failed = persistence === "error";
  const busy = persistence === "loading" || persistence === "saving";
  const future = failed && persistenceError === "FUTURE_SETTINGS_VERSION";
  useEffect(() => {
    // 由全局常驻的 compact 实例维护提示，页面切换不撤掉仍有效的保存错误。
    if (!compact) return;
    const id = "settings-persistence";
    if (!failed || future) {
      toast.dismiss(id);
      return;
    }
    toast.error(t("settings.persistenceError"), {
      id,
      duration: Infinity,
      action: { label: t("common.retry"), onClick: retrySave },
    });
  }, [compact, failed, future, persistenceError, retrySave, t]);
  if (compact && !future) return null;
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
  if (!future)
    return (
      <span role="status" className="sr-only">
        {t("settings.persistenceError")}
      </span>
    );
  if (!showFutureWarning) return null;
  return (
    <div
      role="alert"
      data-surface="solid"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
        {t("settings.persistenceFuture")}
      </span>
    </div>
  );
}

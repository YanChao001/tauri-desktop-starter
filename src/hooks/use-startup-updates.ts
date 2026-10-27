import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSettings } from "@/providers/settings";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { getCurrentWindowLabel, isTauri } from "@/lib/tauri";
import { checkUpdates, getUpdatesSnapshot } from "@/lib/updates-store";
import { reportClientError } from "@/lib/report-error";

/** 主窗口可见、设置就绪后检查一次；后台失败只留在设置的更新区供重试。 */
export function useStartupUpdates() {
  const { settings, persistence } = useSettings();
  const ready = persistence === "saved" || persistence === "saving";
  const enabled = settings.autoCheckUpdates;
  const navigate = useNavigate();
  const t = useLatestTranslator();
  useEffect(() => {
    if (!isTauri() || !ready || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      const label = await getCurrentWindowLabel();
      if (
        disposed ||
        document.hidden ||
        label !== "main" ||
        getUpdatesSnapshot().phase !== "idle"
      )
        return;
      await checkUpdates();
      if (disposed) return;
      const { phase, status } = getUpdatesSnapshot();
      if (phase === "ready" && status?.available && status.version)
        toast.info(t("updates.available", { version: status.version }), {
          id: "available-update",
          duration: 12000,
          action: {
            label: t("updates.viewUpdate"),
            onClick: () => navigate("/settings?section=updates"),
          },
        });
    }
    function schedule() {
      clearTimeout(timer);
      if (!document.hidden && getUpdatesSnapshot().phase === "idle")
        timer = setTimeout(() => void check().catch(reportClientError), 3000);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [enabled, ready, navigate, t]);
}

import { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AppWindowIcon, ClipboardListIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { useRegisterCommands } from "@/providers/commands";
import { useSettings } from "@/providers/settings";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { copyText } from "@/lib/clipboard";
import {
  getDiagnosticsReport,
  isTauri,
  openSecondaryWindow,
} from "@/lib/tauri";
import { reportClientError } from "@/lib/report-error";
import { attachUpdateEvents, checkUpdates } from "@/lib/updates-store";
import type { AppCommand } from "@/commands/types";
import { SettingsPersistence } from "@/components/settings-persistence";
import { useWorkspace } from "@/hooks/use-workspace";
import { useTaskNotifications } from "@/hooks/use-task-notifications";
import { useStartupUpdates } from "@/hooks/use-startup-updates";
export function DesktopEffects() {
  useWorkspace();
  useTaskNotifications();
  useStartupUpdates();
  const { persistence, persistenceError } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const t = useLatestTranslator();
  useEffect(() => {
    const onError = (event: ErrorEvent) =>
      reportClientError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      reportClientError(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri())
      void attachUpdateEvents()
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(reportClientError);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  const actions = useMemo<AppCommand[]>(
    () => [
      {
        id: "open-window",
        labelKey: "commands.openWindow",
        group: "window",
        icon: AppWindowIcon,
        available: isTauri,
        run: async () => {
          await openSecondaryWindow();
        },
      },
      {
        id: "check-updates",
        labelKey: "commands.checkUpdates",
        group: "tools",
        icon: DownloadIcon,
        available: isTauri,
        run: async () => {
          navigate("/settings?section=updates");
          await checkUpdates();
        },
      },
      {
        id: "copy-diagnostics",
        labelKey: "commands.copyDiagnostics",
        group: "tools",
        icon: ClipboardListIcon,
        available: isTauri,
        run: async () => {
          await copyText(JSON.stringify(await getDiagnosticsReport(), null, 2));
          toast.success(t("diagnostics.copied"));
        },
      },
    ],
    [navigate, t],
  );
  useRegisterCommands(actions);
  const showFutureWarning =
    persistence === "error" &&
    persistenceError === "FUTURE_SETTINGS_VERSION" &&
    pathname !== "/settings";
  const persistenceFeedback = (
    <SettingsPersistence compact showFutureWarning={showFutureWarning} />
  );
  return showFutureWarning ? (
    <div className="fixed right-4 bottom-4 z-40 w-[min(32rem,calc(100%-2rem))] shadow-lg">
      {persistenceFeedback}
    </div>
  ) : (
    persistenceFeedback
  );
}

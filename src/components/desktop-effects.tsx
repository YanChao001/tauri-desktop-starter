import { useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import { useNavigate, useLocation } from "react-router-dom";
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
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { persistence } = useSettings();
  const t = useLatestTranslator();
  useEffect(() => {
    if (theme !== settings.theme) setTheme(settings.theme);
  }, [theme, settings.theme, setTheme]);
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
        available: isTauri,
        run: async () => {
          await openSecondaryWindow();
        },
      },
      {
        id: "check-updates",
        labelKey: "commands.checkUpdates",
        group: "tools",
        available: isTauri,
        run: async () => {
          navigate("/updates");
          await checkUpdates();
        },
      },
      {
        id: "copy-diagnostics",
        labelKey: "commands.copyDiagnostics",
        group: "tools",
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
  return persistence === "error" && pathname !== "/settings" ? (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 shadow-lg">
      <SettingsPersistence compact />
    </div>
  ) : null;
}

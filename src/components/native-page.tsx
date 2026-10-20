import type { ReactNode } from "react";
import {
  AlertCircleIcon,
  MonitorIcon,
  DatabaseIcon,
  LayersIcon,
  ArrowRightIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { isTauri } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
function NativePreviewActions() {
  const { settings } = useSettings();
  const { t } = useI18n();
  const minimal = settings.appMode === "minimal";
  return (
    <div className="studio-native-actions">
      <Button asChild>
        <Link to={minimal ? "/" : "/components"}>
          {t(minimal ? "showroom.workspace" : "studio.nativeCta")}
          <ArrowRightIcon />
        </Link>
      </Button>
      <Button asChild variant="ghost">
        <Link to={minimal ? "/settings" : "/motion"}>
          {t(minimal ? "nav.settings" : "studio.nativeMotion")}
        </Link>
      </Button>
    </div>
  );
}
export function NativePage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="studio-page">
      <div className="studio-intro">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {isTauri() ? (
        children
      ) : (
        <section className="studio-panel studio-native-preview">
          <div className="studio-native-art" aria-hidden="true">
            <div>
              <MonitorIcon size={32} />
            </div>
            <div>
              <DatabaseIcon size={32} />
            </div>
          </div>
          <div className="studio-native-copy">
            <h3>{t("studio.nativeTitle")}</h3>
            <p>{t("studio.nativeDescription")}</p>
            <div className="studio-native-tags">
              <span>{t("studio.nativeWindow")}</span>
              <span>{t("studio.nativeData")}</span>
              <span>{t("studio.nativeSystem")}</span>
            </div>
            <NativePreviewActions />
          </div>
          <p className="studio-native-note">
            <LayersIcon size={13} />
            {t("studio.nativeNote")}
          </p>
        </section>
      )}
    </div>
  );
}
export function ResourceError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-background p-3 text-sm"
    >
      <span className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
        {nativeErrorText(error, t)}
      </span>
      <Button size="sm" variant="outline" onClick={retry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

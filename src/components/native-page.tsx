import type { ReactNode } from "react";
import { AlertCircleIcon, LayersIcon, ArrowRightIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n, type DictKey } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { isTauri } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import "@/styles/experience.css";

const PREVIEWS: Record<string, readonly DictKey[]> = {
  "/extensions": [
    "experience.preview.extensions.1",
    "experience.preview.extensions.2",
    "experience.preview.extensions.3",
  ],
  "/workbench": [
    "experience.preview.workbench.1",
    "experience.preview.workbench.2",
    "experience.preview.workbench.3",
  ],
  "/tasks": [
    "experience.preview.tasks.1",
    "experience.preview.tasks.2",
    "experience.preview.tasks.3",
  ],
  "/database": [
    "experience.preview.database.1",
    "experience.preview.database.2",
    "experience.preview.database.3",
  ],
  "/desktop": [
    "experience.preview.desktop.1",
    "experience.preview.desktop.2",
    "experience.preview.desktop.3",
  ],
  "/system": [
    "experience.preview.system.1",
    "experience.preview.system.2",
    "experience.preview.system.3",
  ],
  "/diagnostics": [
    "experience.preview.diagnostics.1",
    "experience.preview.diagnostics.2",
    "experience.preview.diagnostics.3",
  ],
  "/updates": [
    "experience.preview.updates.1",
    "experience.preview.updates.2",
    "experience.preview.updates.3",
  ],
  "/recovery": [
    "experience.preview.recovery.1",
    "experience.preview.recovery.2",
    "experience.preview.recovery.3",
  ],
};

function NativeFlow() {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const steps = PREVIEWS[pathname] ?? PREVIEWS["/desktop"]!;
  return (
    <ol className="native-flow">
      {steps.map((step, index) => (
        <li key={step}>
          <span>0{index + 1}</span>
          <strong>{t(step)}</strong>
        </li>
      ))}
    </ol>
  );
}
function NativePreviewActions() {
  const { settings } = useSettings();
  const { t } = useI18n();
  const minimal = settings.appMode === "minimal";
  return (
    <div className="studio-native-actions">
      <Button asChild>
        <Link to={minimal ? "/" : "/catalog"}>
          {t(minimal ? "showroom.workspace" : "experience.previewOpen")}
          <ArrowRightIcon />
        </Link>
      </Button>
      <Button asChild variant="ghost">
        <Link to="/settings">{t("nav.settings")}</Link>
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
      {title || description ? (
        <div className="studio-intro">
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      {isTauri() ? (
        children
      ) : (
        <section className="studio-panel studio-native-preview native-journey-preview">
          <div className="studio-native-copy">
            <h3>{t("experience.previewTitle")}</h3>
            <p>{t("experience.previewHint")}</p>
            <NativeFlow />
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

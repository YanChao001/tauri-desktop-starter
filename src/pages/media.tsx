import { lazy, Suspense } from "react";
import { MarkdownPanel, MediaPreview } from "@/features/media/content-panels";
import { SidecarPanel, WebSocketPanel } from "@/features/media/realtime-panels";
import { useI18n } from "@/providers/i18n";

const MetricsChart = lazy(() =>
  import("@/features/media/metrics-chart").then((module) => ({
    default: module.MetricsChart,
  })),
);

export default function Media() {
  const { t } = useI18n();
  return (
    <div className="studio-page space-y-5">
      <div className="studio-intro">
        <span className="studio-eyebrow">{t("labs.eyebrow")}</span>
        <h2>{t("labs.media.title")}</h2>
        <p>{t("labs.media.description")}</p>
      </div>
      <MarkdownPanel />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <MediaPreview />
        <Suspense
          fallback={
            <div
              role="status"
              className="min-h-96 rounded-xl bg-card p-4 text-sm text-muted-foreground"
            >
              {t("labs.loading")}
            </div>
          }
        >
          <MetricsChart />
        </Suspense>
        <WebSocketPanel />
        <SidecarPanel />
      </div>
    </div>
  );
}

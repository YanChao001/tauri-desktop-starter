import { lazy, Suspense, useState } from "react";
import { HelpTooltip } from "@/components/help-tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownPanel, MediaPreview } from "@/features/media/content-panels";
import { SidecarPanel, WebSocketPanel } from "@/features/media/realtime-panels";
import { useI18n } from "@/providers/i18n";
import "@/styles/experience.css";

const MetricsChart = lazy(() =>
  import("@/features/media/metrics-chart").then((module) => ({
    default: module.MetricsChart,
  })),
);

export default function Media() {
  const { t } = useI18n();
  const [view, setView] = useState("content");
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    () => new Set(["content"]),
  );
  return (
    <div className="studio-page space-y-5">
      <div className="studio-intro">
        <span className="studio-eyebrow">{t("labs.eyebrow")}</span>
        <h2 className="flex items-center gap-2">
          {t("labs.media.title")}
          <HelpTooltip label={`${t("labs.media.title")} · ${t("title.help")}`}>
            {t("labs.media.description")}
          </HelpTooltip>
        </h2>
      </div>
      <Tabs
        value={view}
        onValueChange={(next) => {
          setView(next);
          setVisited((current) => new Set([...current, next]));
        }}
        className="demo-page-tabs"
      >
        <div className="flex items-center gap-2">
          <TabsList aria-label={t("experience.media.tabs")}>
            {(["content", "charts", "connections"] as const).map((id) => (
              <TabsTrigger key={id} value={id}>
                {t(`experience.media.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <HelpTooltip
            label={`${t("experience.media.connections")} · ${t("title.help")}`}
          >
            {t("experience.media.connectionHint")}
          </HelpTooltip>
        </div>
        <TabsContent
          value="content"
          forceMount
          hidden={view !== "content"}
          className="demo-tab-panel space-y-5"
        >
          <MarkdownPanel />
          <MediaPreview />
        </TabsContent>
        <TabsContent
          value="charts"
          forceMount
          hidden={view !== "charts"}
          className="demo-tab-panel"
        >
          {visited.has("charts") && (
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
          )}
        </TabsContent>
        <TabsContent
          value="connections"
          forceMount
          hidden={view !== "connections"}
          className="demo-tab-panel space-y-5"
        >
          {visited.has("connections") && (
            <>
              <WebSocketPanel />
              <SidecarPanel />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

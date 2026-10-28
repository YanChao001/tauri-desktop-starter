import { lazy, Suspense, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BellRingIcon,
  LayersIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectStudio } from "@/components/showcase/project-studio";
import { FeedbackStudio } from "@/components/showcase/feedback-studio";
import { ResourceLibrary } from "@/components/showcase/resource-library";
import { ControlReference } from "@/components/showcase/control-reference";
import { WorkspaceStudio } from "@/components/showcase/workspace-studio";
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useI18n } from "@/providers/i18n";
import "@/styles/components-showcase.css";

const MotionStudio = lazy(() =>
  import("@/components/motion-lab/motion-studio").then((module) => ({
    default: module.MotionStudio,
  })),
);

const STAGES = [
  { id: "inputs", label: "playground.inputs", icon: SlidersHorizontalIcon },
  { id: "feedback", label: "playground.feedback", icon: BellRingIcon },
  { id: "data", label: "playground.data", icon: LayersIcon },
  {
    id: "workspace",
    label: "experience.workspace",
    icon: SlidersHorizontalIcon,
  },
  { id: "motion", label: "nav.motion", icon: SparklesIcon },
] as const;

export default function Components() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStage = searchParams.get("stage");
  const stage =
    STAGES.find((item) => item.id === requestedStage)?.id ?? "inputs";
  const [motionVisited, setMotionVisited] = useState(false);
  function setStage(value: string) {
    if (stage === "motion" || value === "motion") setMotionVisited(true);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("stage", value);
        return next;
      },
      { replace: true },
    );
  }
  const root = useRef<HTMLDivElement>(null);
  const { active, reduced } = useDemoMotion(root);
  return (
    <div
      ref={root}
      className="playground"
      data-active={active}
      data-reduced={reduced}
    >
      <header className="studio-intro playground-heading">
        <h2>{t("playground.title")}</h2>
        <p>{t("playground.description")}</p>
      </header>
      <Tabs value={stage} onValueChange={setStage} className="playground-tabs">
        <TabsList
          aria-label={t("playground.stages")}
          className="playground-stage-list app-control-surface"
        >
          {STAGES.map(({ id, label, icon: Icon }, index) => (
            <TabsTrigger
              key={id}
              value={id}
              className="playground-stage-trigger"
            >
              <span className="playground-stage-index" aria-hidden="true">
                0{index + 1}
              </span>
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* 隐藏阶段保持挂载以保留本页编辑；不提供持久化存储 */}
        <TabsContent
          value="inputs"
          forceMount
          hidden={stage !== "inputs"}
          className="playground-stage"
        >
          <ProjectStudio active={stage === "inputs"} />
        </TabsContent>
        <TabsContent
          value="feedback"
          forceMount
          hidden={stage !== "feedback"}
          className="playground-stage"
        >
          <FeedbackStudio />
        </TabsContent>
        <TabsContent
          value="data"
          forceMount
          hidden={stage !== "data"}
          className="playground-stage"
        >
          <ResourceLibrary active={stage === "data"} />
        </TabsContent>
        <TabsContent
          value="workspace"
          forceMount
          hidden={stage !== "workspace"}
          className="playground-stage"
        >
          <WorkspaceStudio />
        </TabsContent>
        <TabsContent
          value="motion"
          forceMount
          hidden={stage !== "motion"}
          className="playground-stage"
        >
          {stage === "motion" || motionVisited ? (
            <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
              <MotionStudio enabled={stage === "motion"} />
            </Suspense>
          ) : null}
        </TabsContent>
      </Tabs>
      {stage !== "motion" ? <ControlReference /> : null}
    </div>
  );
}

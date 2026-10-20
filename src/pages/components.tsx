import { useRef, useState } from "react";
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
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useI18n } from "@/providers/i18n";
import "@/styles/components-showcase.css";

const STAGES = [
  { id: "inputs", label: "playground.inputs", icon: SlidersHorizontalIcon },
  { id: "feedback", label: "playground.feedback", icon: BellRingIcon },
  { id: "data", label: "playground.data", icon: LayersIcon },
] as const;

export default function Components() {
  const { t } = useI18n();
  const [stage, setStage] = useState("inputs");
  const root = useRef<HTMLDivElement>(null);
  const { active, reduced } = useDemoMotion(root);
  return (
    <div
      ref={root}
      className="playground"
      data-active={active}
      data-reduced={reduced}
    >
      <header className="playground-heading">
        <p className="playground-eyebrow">
          <SparklesIcon aria-hidden="true" />
          {t("playground.eyebrow")}
        </p>
        <h2>{t("playground.title")}</h2>
        <p>{t("playground.description")}</p>
      </header>
      <Tabs value={stage} onValueChange={setStage} className="playground-tabs">
        <TabsList
          aria-label={t("playground.stages")}
          className="playground-stage-list"
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
        {/* Mounted, hidden stages retain this page's edits without creating a persistence promise. */}
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
      </Tabs>
      <ControlReference />
    </div>
  );
}

import {
  createRef,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AtomIcon,
  CheckIcon,
  LayersIcon,
  OrbitIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useI18n } from "@/providers/i18n";
import { SpringScene } from "@/components/motion-lab/spring-scene";
import { LayoutScene } from "@/components/motion-lab/layout-scene";
import { TiltScene } from "@/components/motion-lab/tilt-scene";
import { PathScene } from "@/components/motion-lab/path-scene";
import "@/styles/motion-lab.css";
const SCENES = [
  {
    id: "spring",
    label: "lab.spring",
    title: "lab.springTitle",
    hint: "lab.springHint",
    icon: AtomIcon,
  },
  {
    id: "layout",
    label: "lab.layout",
    title: "lab.layoutTitle",
    hint: "lab.layoutHint",
    icon: LayersIcon,
  },
  {
    id: "tilt",
    label: "lab.tilt",
    title: "lab.tiltTitle",
    hint: "lab.tiltHint",
    icon: SparklesIcon,
  },
  {
    id: "paths",
    label: "lab.paths",
    title: "lab.pathsTitle",
    hint: "lab.pathsHint",
    icon: OrbitIcon,
  },
] as const;
type SceneId = (typeof SCENES)[number]["id"];
export default function MotionLab() {
  const { t } = useI18n();
  const [scene, setScene] = useState<SceneId>("spring");
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const stages = useMemo(
    () => ({
      spring: createRef<HTMLDivElement>(),
      layout: createRef<HTMLDivElement>(),
      tilt: createRef<HTMLDivElement>(),
      paths: createRef<HTMLDivElement>(),
    }),
    [],
  );
  const stageRef = stages[scene];
  const { reduced, active, visible } = useDemoMotion(stageRef, !paused);
  const selected = SCENES.find((item) => item.id === scene)!;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onTabKey = (event: KeyboardEvent, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % SCENES.length;
    else if (event.key === "ArrowLeft")
      next = (index + SCENES.length - 1) % SCENES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SCENES.length - 1;
    else return;
    event.preventDefault();
    setScene(SCENES[next]!.id);
    tabRefs.current[next]?.focus();
  };
  return (
    <div
      className="motion-lab"
      data-reduced={reduced}
      data-paused={paused || !visible}
    >
      <header className="studio-intro lab-heading">
        <div className="lab-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <h2>{t("lab.title")}</h2>
        <p>{t("lab.subtitle")}</p>
      </header>
      <div
        className="lab-scene-tabs"
        role="tablist"
        aria-label={t("lab.scenes")}
      >
        {SCENES.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`lab-tab-${item.id}`}
            aria-controls={`lab-panel-${item.id}`}
            aria-selected={scene === item.id}
            tabIndex={scene === item.id ? 0 : -1}
            onClick={() => setScene(item.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <item.icon />
            <span>{t(item.label)}</span>
            <span className="lab-scene-number" aria-hidden="true">
              0{index + 1}
            </span>
          </button>
        ))}
      </div>
      <section
        className="lab-console"
        data-scene={scene}
        role="tabpanel"
        id={`lab-panel-${scene}`}
        aria-labelledby={`lab-tab-${scene}`}
      >
        <div className="lab-console-heading">
          <div>
            <span className="lab-status">
              <i />
              {t(
                reduced
                  ? "lab.reduced"
                  : paused || !visible
                    ? "lab.paused"
                    : "lab.live",
              )}
            </span>
            <h3>{t(selected.title)}</h3>
            <p>{t(selected.hint)}</p>
          </div>
          <div className="lab-toolbar">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={reduced}
              aria-label={t(paused ? "lab.resume" : "lab.pause")}
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("lab.replay")}
              onClick={() => setReplay((value) => value + 1)}
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </div>
        <div className="lab-experiment">
          {scene === "spring" && (
            <SpringScene
              active={active}
              reduced={reduced}
              replay={replay}
              stageRef={stageRef}
            />
          )}
          {scene === "layout" && (
            <LayoutScene
              active={active}
              reduced={reduced}
              replay={replay}
              stageRef={stageRef}
            />
          )}
          {scene === "tilt" && (
            <TiltScene
              active={active}
              reduced={reduced}
              replay={replay}
              stageRef={stageRef}
            />
          )}
          {scene === "paths" && (
            <PathScene
              active={active}
              reduced={reduced}
              replay={replay}
              stageRef={stageRef}
            />
          )}
        </div>
      </section>
      {reduced && (
        <p className="lab-reduced-note">
          <CheckIcon />
          {t("lab.reducedHint")}
        </p>
      )}
      <div className="lab-footer">
        <span aria-hidden="true">✳</span>
        <p>{t("lab.footer")}</p>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  useMotionValueEvent,
  type MotionValue,
} from "motion/react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/providers/i18n";
import { useOrbit, usePlaybackGate, type Playback } from "./playback";
import { Notes, RangeControl, StageGuides, type SceneProps } from "./shared";
const TRACKS = [
  "M96 224C126 98 260 48 378 102S572 156 538 240C504 312 324 258 206 194S130 92 96 224",
  "M124 78C294 10 528 90 510 192S296 302 188 238S74 138 124 78",
  "M182 266C82 192 178 54 336 62S572 210 442 264S278 308 182 266",
];
function Stardust({
  index,
  phase,
  burst,
}: {
  index: number;
  phase: MotionValue<number>;
  burst: boolean;
}) {
  const x = useTransform(
    phase,
    (value) =>
      320 +
      Math.cos(
        ((value * (index % 2 ? 1 : -1) + index * 137.5) * Math.PI) / 180,
      ) *
        (burst ? 125 + (index % 5) * 27 : 120 + (index % 4) * 20),
  );
  const y = useTransform(
    phase,
    (value) =>
      158 +
      Math.sin(
        ((value * (index % 2 ? 1 : -1) + index * 137.5) * Math.PI) / 180,
      ) *
        (burst ? 65 + (index % 4) * 20 : 54 + (index % 3) * 14),
  );
  return (
    <motion.circle
      cx={x}
      cy={y}
      r={index % 6 === 0 ? 3 : 1.4}
      className="lab-stardust"
      opacity={0.3 + (index % 4) * 0.18}
    />
  );
}
function Trail({
  path,
  phase,
  index,
}: {
  path: string;
  phase: MotionValue<number>;
  index: number;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  useMotionValueEvent(phase, "change", (value) => {
    if (pathRef.current)
      pathRef.current.style.strokeDashoffset = String(
        -value / 3.6 - (index * 100) / 3,
      );
  });
  return (
    <path
      ref={pathRef}
      d={path}
      pathLength={100}
      strokeDasharray="13 87"
      strokeDashoffset={(-index * 100) / 3}
      className={`lab-orbit-trail lab-path-${index}`}
    />
  );
}
export function PathScene({ active, reduced, replay, stageRef }: SceneProps) {
  const { t } = useI18n();
  const [duration, setDuration] = useState(4);
  const [density, setDensity] = useState(20);
  const [loop, setLoop] = useState(true);
  const [burst, setBurst] = useState(false);
  const progress = useMotionValue(0);
  const phase = useOrbit(active, reduced, burst ? 9 : 28);
  const control = useRef<Playback | null>(null);
  const playing = usePlaybackGate(control, active);
  useEffect(() => {
    if (reduced) {
      progress.jump(1);
      return;
    }
    progress.jump(0);
    const animation = animate(progress, 1, {
      duration,
      ease: "easeInOut",
      repeat: loop ? Infinity : 0,
      repeatType: "reverse",
      repeatDelay: 1,
    });
    control.current = animation;
    if (!playing.current) animation.pause();
    return () => {
      animation.stop();
      control.current = null;
    };
  }, [duration, loop, replay, reduced, progress, playing]);
  return (
    <>
      <div className="lab-stage lab-path-stage" ref={stageRef}>
        <StageGuides label={t("lab.paths")} />
        <svg
          viewBox="0 0 640 320"
          className="lab-artwork"
          aria-hidden="true"
          focusable="false"
        >
          <g className="lab-path-background">
            {TRACKS.map((path) => (
              <path key={path} d={path} />
            ))}
          </g>
          {TRACKS.map((path, index) => (
            <motion.path
              key={path}
              d={path}
              pathLength={progress}
              className={`lab-drawn-path lab-path-${index}`}
            />
          ))}
          {TRACKS.map((path, index) => (
            <Trail key={path} path={path} index={index} phase={phase} />
          ))}
          <g>
            {Array.from(
              { length: burst ? Math.min(60, density * 2) : density },
              (_, index) => (
                <Stardust
                  key={index}
                  index={index}
                  phase={phase}
                  burst={burst}
                />
              ),
            )}
          </g>
          <circle cx="320" cy="158" r="42" className="lab-path-core" />
          <circle cx="320" cy="158" r="53" className="lab-path-core-ring" />
          <circle cx="320" cy="158" r="65" className="lab-path-core-ring" />
          <path
            d="M320 132L327 151L346 158L327 165L320 184L313 165L294 158L313 151Z"
            className="lab-path-star"
          />
        </svg>
        <div className="lab-stage-actions">
          <Button
            size="sm"
            variant={burst ? "default" : "outline"}
            aria-pressed={burst}
            onClick={() => setBurst((value) => !value)}
          >
            <SparklesIcon />
            {t(burst ? "lab.burstOff" : "lab.burst")}
          </Button>
        </div>
      </div>
      <aside className="lab-control-panel">
        <h3>{t("lab.controls")}</h3>
        <div className="lab-controls-fields">
          <RangeControl
            label={t("lab.duration")}
            value={duration}
            min={1}
            max={8}
            suffix="s"
            onChange={setDuration}
          />
          <RangeControl
            label={t("lab.density")}
            value={density}
            min={8}
            max={40}
            step={4}
            onChange={setDensity}
          />
        </div>
        <label className="lab-loop">
          <Checkbox
            checked={loop}
            onCheckedChange={(checked) => setLoop(checked === true)}
          />
          <span>{t("lab.loop")}</span>
        </label>
        <Notes>{t("lab.pathNote")}</Notes>
      </aside>
    </>
  );
}

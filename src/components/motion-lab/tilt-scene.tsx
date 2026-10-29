import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { MoveUpRightIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { Notes, RangeControl, StageGuides, type SceneProps } from "./shared";
import { usePlaybackGate, type Playback } from "./playback";
export function TiltScene({ active, reduced, replay, stageRef }: SceneProps) {
  const { t } = useI18n();
  const instructions = useId();
  const [strength, setStrength] = useState(15);
  const [flipped, setFlipped] = useState(false);
  const horizontal = useMotionValue(0);
  const vertical = useMotionValue(0);
  const x = useSpring(horizontal, { stiffness: 220, damping: 26 });
  const y = useSpring(vertical, { stiffness: 220, damping: 26 });
  const flipAngle = useMotionValue(0);
  const rotationY = useTransform(() => x.get() + flipAngle.get());
  const flipControl = useRef<Playback | null>(null);
  const playing = usePlaybackGate(flipControl, active);
  useEffect(() => {
    if (reduced) {
      flipAngle.jump(0);
      return;
    }
    const control = animate(flipAngle, flipped ? 180 : 0, {
      type: "spring",
      stiffness: 160,
      damping: 24,
    });
    flipControl.current = control;
    if (!playing.current) control.pause();
    return () => {
      control.stop();
      flipControl.current = null;
    };
  }, [flipped, reduced, flipAngle, playing]);
  const glareX = useTransform(x, (value) => `${50 + value / 2}%`);
  const glareY = useTransform(y, (value) => `${50 + value / 2}%`);
  const reset = () => {
    if (active) {
      horizontal.set(0);
      vertical.set(0);
    } else {
      horizontal.jump(0);
      vertical.jump(0);
      x.jump(0);
      y.jump(0);
    }
  };
  useEffect(() => {
    if (!active) {
      x.stop();
      y.stop();
    }
  }, [active, x, y]);
  useEffect(() => {
    horizontal.jump(0);
    vertical.jump(0);
    x.jump(0);
    y.jump(0);
  }, [replay, horizontal, vertical, x, y]);
  const point = (event: PointerEvent<HTMLButtonElement>) => {
    if (!active) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    horizontal.set(
      Math.max(
        -1,
        Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1),
      ) * strength,
    );
    vertical.set(
      Math.max(
        -1,
        Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1),
      ) * -strength,
    );
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      reset();
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    if (!active) return;
    if (event.key === "ArrowLeft")
      horizontal.set(Math.max(-strength, horizontal.get() - 4));
    if (event.key === "ArrowRight")
      horizontal.set(Math.min(strength, horizontal.get() + 4));
    if (event.key === "ArrowUp")
      vertical.set(Math.min(strength, vertical.get() + 4));
    if (event.key === "ArrowDown")
      vertical.set(Math.max(-strength, vertical.get() - 4));
  };
  return (
    <>
      <div
        data-surface="artwork"
        className="lab-stage lab-tilt-stage"
        ref={stageRef}
      >
        <StageGuides label={t("lab.tilt")} />
        <div className="lab-tilt-halo" />
        <span className="sr-only" id={instructions}>
          {t("lab.tiltCard")}
        </span>
        <motion.button
          data-surface="artwork"
          type="button"
          className="lab-tilt-card"
          aria-describedby={instructions}
          aria-pressed={flipped}
          onClick={() => setFlipped((value) => !value)}
          onPointerMove={point}
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse")
              event.currentTarget.setPointerCapture?.(event.pointerId);
            point(event);
          }}
          onPointerLeave={reset}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture?.(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            reset();
          }}
          onPointerCancel={reset}
          onBlur={reset}
          onKeyDown={key}
          style={{
            rotateY: reduced ? 0 : rotationY,
            rotateX: reduced ? 0 : y,
            transformPerspective: 900,
          }}
        >
          <motion.span
            className="lab-card-glare"
            aria-hidden="true"
            style={{ left: glareX, top: glareY }}
          />
          {([false, true] as const).map((back) => (
            <span
              key={String(back)}
              className={`lab-tilt-face${back ? " lab-tilt-face-back" : ""}`}
              aria-hidden={back !== flipped}
            >
              <span className="lab-card-edition">
                {t("lab.cardEdition")}
                <SparklesIcon />
              </span>
              <span className="lab-hologram" aria-hidden="true">
                <i />
                <i />
                <i />
                <b />
              </span>
              <span className="lab-tilt-message">
                {t(back ? "lab.cardBack" : "lab.cardFront")}
              </span>
              <span className="lab-card-signature">
                {t("lab.cardSignature")}
                <MoveUpRightIcon />
              </span>
            </span>
          ))}
        </motion.button>
      </div>
      <aside className="lab-control-panel">
        <h3>{t("lab.controls")}</h3>
        <RangeControl
          label={t("lab.tiltStrength")}
          value={strength}
          min={5}
          max={25}
          suffix="°"
          onChange={setStrength}
        />
        <div className="lab-control-buttons">
          <Button
            variant="outline"
            onClick={() => setFlipped((value) => !value)}
          >
            {t("lab.flip")}
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RotateCcwIcon />
            {t("lab.resetTilt")}
          </Button>
        </div>
        <Notes>{t("lab.tiltNote")}</Notes>
      </aside>
    </>
  );
}

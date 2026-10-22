import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import {
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { springCurve, type SpringParameters } from "./physics";
import { useOrbit, usePlaybackGate, type Playback } from "./playback";
import { Notes, RangeControl, StageGuides, type SceneProps } from "./shared";

export function SpringScene({ active, reduced, replay, stageRef }: SceneProps) {
  const { t } = useI18n();
  const [parameters, setParameters] = useState<SpringParameters>({
    stiffness: 160,
    damping: 14,
    mass: 1,
  });
  const [target, setTarget] = useState(420);
  const [launch, setLaunch] = useState(0);
  const drag = useRef<number | null>(null);
  const handle = useRef<SVGCircleElement>(null);
  const position = useMotionValue(220);
  const control = useRef<Playback | null>(null);
  const playing = usePlaybackGate(control, active);
  const previousReplay = useRef(replay);
  const rotation = useOrbit(active, reduced, 20);
  const tether = useTransform(
    position,
    (value) =>
      `M 220 164 C ${240 + (value - 220) / 3} 96, ${value - 20} 226, ${value} 164`,
  );
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const send = (next: number) => {
    setTarget(next);
    setLaunch((value) => value + 1);
  };
  function dragMove(event: PointerEvent<SVGCircleElement>) {
    if (drag.current !== event.pointerId || !active) return;
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    position.jump(Math.max(120, Math.min(520, point.x)));
  }
  function release(event: PointerEvent<SVGCircleElement>) {
    if (drag.current !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    send(position.get() < 320 ? 220 : 420);
  }
  useEffect(() => {
    if (active || drag.current === null) return;
    const id = drag.current;
    drag.current = null;
    if (handle.current?.hasPointerCapture(id))
      handle.current.releasePointerCapture(id);
  }, [active]);
  useEffect(() => {
    if (reduced) {
      position.jump(target);
      return;
    }
    if (previousReplay.current !== replay) {
      position.jump(target === 420 ? 220 : 420);
      previousReplay.current = replay;
    }
    const animation = animate(position, target, {
      type: "spring",
      ...parameters,
      restDelta: 0.05,
      restSpeed: 0.05,
    });
    control.current = animation;
    if (!playing.current) animation.pause();
    return () => {
      animation.stop();
      control.current = null;
    };
  }, [target, parameters, replay, reduced, position, playing, launch]);
  const ratio =
    parameters.damping /
    (2 * Math.sqrt(parameters.stiffness * parameters.mass));
  const presets = [
    { label: "lab.velvet", stiffness: 100, damping: 18, mass: 1.4 },
    { label: "lab.playful", stiffness: 220, damping: 9, mass: 0.8 },
    { label: "lab.precise", stiffness: 340, damping: 32, mass: 1 },
  ] as const;
  return (
    <>
      <div
        className="lab-stage lab-spring-stage"
        data-testid="spring-stage"
        ref={stageRef}
      >
        <StageGuides label={t("lab.spring")} />
        <div className="lab-stage-aura" />
        <svg
          viewBox="0 0 640 320"
          className="lab-artwork"
          role="group"
          aria-label={t("lab.springTitle")}
          focusable="false"
        >
          <defs>
            <radialGradient id={`${id}-orb`} cx="30%" cy="20%">
              <stop stopColor="white" stopOpacity=".95" />
              <stop offset=".33" stopColor="var(--lab-art)" stopOpacity=".65" />
              <stop offset="1" stopColor="var(--lab-art)" />
            </radialGradient>
          </defs>
          <g className="lab-track-marks">
            {Array.from({ length: 21 }, (_, i) => (
              <path
                key={i}
                d={`M${120 + i * 20} 240v${i % 5 === 0 ? 12 : 6}`}
              />
            ))}
          </g>
          <path d="M100 244H540" className="lab-axis" />
          <ellipse cx="220" cy="244" rx="48" ry="8" className="lab-pad" />
          <ellipse cx="420" cy="244" rx="48" ry="8" className="lab-pad" />
          <motion.path d={tether} fill="none" className="lab-tether" />
          <motion.g style={{ x: position }}>
            <ellipse cy="244" rx="54" ry="8" className="lab-orb-shadow" />
            <circle cy="164" r="46" fill={`url(#${id}-orb)`} />
            <circle cy="164" r="53" className="lab-orb-rim" />
            <circle cy="164" r="65" className="lab-orb-rim lab-orb-rim-outer" />
            <motion.g style={{ rotate: rotation }}>
              <ellipse cy="164" rx="72" ry="21" className="lab-orbit-ring" />
              <circle cx="68" cy="170" r="4" className="lab-orbit-spark" />
            </motion.g>
            <circle cx="-13" cy="149" r="12" fill="white" opacity=".16" />
          </motion.g>
          <motion.circle
            ref={handle}
            cx={position}
            cy="164"
            r="52"
            className="lab-spring-handle"
            role="button"
            tabIndex={0}
            aria-label={t("lab.dragOrb")}
            focusable="true"
            onPointerDown={(event) => {
              if (!active || event.button !== 0 || drag.current !== null)
                return;
              event.preventDefault();
              event.currentTarget.focus();
              control.current?.stop();
              drag.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={dragMove}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={() => {
              if (drag.current !== null) {
                drag.current = null;
                send(target);
              }
            }}
            onKeyDown={(event) => {
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                  "Enter",
                  " ",
                ].includes(event.key)
              ) {
                event.preventDefault();
                send(
                  event.key === "ArrowLeft" || event.key === "Home"
                    ? 220
                    : event.key === "ArrowRight" || event.key === "End"
                      ? 420
                      : target === 420
                        ? 220
                        : 420,
                );
              }
            }}
          />
          <text x="220" y="278" textAnchor="middle" className="lab-axis-label">
            A
          </text>
          <text x="420" y="278" textAnchor="middle" className="lab-axis-label">
            B
          </text>
        </svg>
        <div className="lab-stage-actions">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t("lab.left")}
            onClick={() => send(220)}
          >
            <ArrowLeftIcon />
          </Button>
          <Button onClick={() => send(target === 420 ? 220 : 420)} size="sm">
            <ArrowLeftRightIcon />
            {t("lab.throw")}
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t("lab.right")}
            onClick={() => send(420)}
          >
            <ArrowRightIcon />
          </Button>
        </div>
      </div>
      <aside className="lab-control-panel">
        <h3>{t("lab.controls")}</h3>
        <div className="lab-controls-fields">
          <RangeControl
            label={t("lab.stiffness")}
            value={parameters.stiffness}
            min={40}
            max={400}
            step={10}
            onChange={(stiffness) =>
              setParameters((value) => ({ ...value, stiffness }))
            }
          />
          <RangeControl
            label={t("lab.damping")}
            value={parameters.damping}
            min={4}
            max={45}
            onChange={(damping) =>
              setParameters((value) => ({ ...value, damping }))
            }
          />
          <RangeControl
            label={t("lab.mass")}
            value={parameters.mass}
            min={0.5}
            max={3}
            step={0.1}
            suffix="×"
            onChange={(mass) => setParameters((value) => ({ ...value, mass }))}
          />
        </div>
        <div className="lab-presets">
          <span>{t("lab.presets")}</span>
          <div>
            {presets.map(({ label, ...preset }) => (
              <button
                key={label}
                type="button"
                aria-pressed={Object.entries(preset).every(
                  ([key, value]) =>
                    parameters[key as keyof SpringParameters] === value,
                )}
                onClick={() => setParameters(preset)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <div className="lab-response">
          <div>
            <span>{t("lab.response")}</span>
            <strong>
              {t(
                ratio < 0.75
                  ? "lab.bouncy"
                  : ratio <= 1.15
                    ? "lab.balanced"
                    : "lab.heavy",
              )}
            </strong>
          </div>
          <svg viewBox="0 0 180 80" role="img" aria-label={t("lab.response")}>
            <path d="M0 40H180" className="lab-response-goal" />
            <path d={springCurve(parameters)} className="lab-response-line" />
          </svg>
        </div>
        <Notes>{t("lab.springNote")}</Notes>
      </aside>
    </>
  );
}

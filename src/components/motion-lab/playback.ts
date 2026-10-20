import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { animate, useMotionValue } from "motion/react";
export type Playback = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  state?: string;
};
/** MotionConfig alone does not pause imperative loops or SVG drawing. */
export function usePlaybackGate(
  control: RefObject<Playback | null>,
  active: boolean,
) {
  const playing = useRef(active);
  useLayoutEffect(() => {
    playing.current = active;
    if (active) {
      if (control.current?.state !== "finished") control.current?.play();
    } else control.current?.pause();
  }, [active, control]);
  return playing;
}
export function useOrbit(active: boolean, reduced: boolean, period = 24) {
  const phase = useMotionValue(0);
  const control = useRef<Playback | null>(null);
  const playing = usePlaybackGate(control, active);
  useEffect(() => {
    if (reduced) {
      phase.jump(0);
      return;
    }
    const animation = animate(phase, phase.get() + 360, {
      duration: period,
      ease: "linear",
      repeat: Infinity,
    });
    control.current = animation;
    if (!playing.current) animation.pause();
    return () => {
      animation.stop();
      control.current = null;
    };
  }, [phase, reduced, period, playing]);
  return phase;
}

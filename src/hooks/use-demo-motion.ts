import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { useSettings } from "@/providers/settings";

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeReduced(listener: () => void) {
  const query = window.matchMedia?.(reducedQuery);
  query?.addEventListener?.("change", listener);
  return () => query?.removeEventListener?.("change", listener);
}
const getReduced = () => window.matchMedia?.(reducedQuery).matches ?? false;
function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
const getVisible = () => document.visibilityState !== "hidden";

/** A single activity policy for interactive artwork and animation experiments. */
export function useDemoMotion(ref?: RefObject<Element | null>, enabled = true) {
  const { settings } = useSettings();
  const systemReduced = useSyncExternalStore(
    subscribeReduced,
    getReduced,
    () => true,
  );
  const pageVisible = useSyncExternalStore(
    subscribeVisibility,
    getVisible,
    () => false,
  );
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref?.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.05 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  const reduced = systemReduced || settings.motion === "reduced";
  const visible = pageVisible && inView;
  return { reduced, visible, active: !reduced && visible && enabled };
}

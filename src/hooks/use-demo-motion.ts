import {
  useEffect,
  useRef,
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

/** 交互插画与动效实验共用的活动状态策略 */
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
  const observation = useRef<{
    element: Element;
    observer: IntersectionObserver;
  } | null>(null);
  // 条件分支挂载后，稳定的 ref 才可能获得目标节点
  // 每次提交后同步目标；节点未变化时复用观察器
  useEffect(() => {
    const element = ref?.current;
    if (observation.current?.element === element) return;
    observation.current?.observer.disconnect();
    observation.current = null;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (observation.current?.observer === observer)
          setInView(entry?.isIntersecting ?? false);
      },
      { threshold: 0.05 },
    );
    observation.current = { element, observer };
    observer.observe(element);
  });
  useEffect(
    () => () => {
      observation.current?.observer.disconnect();
      observation.current = null;
    },
    [],
  );
  const reduced = systemReduced || settings.motion === "reduced";
  const visible = pageVisible && inView;
  return { reduced, visible, active: !reduced && visible && enabled };
}

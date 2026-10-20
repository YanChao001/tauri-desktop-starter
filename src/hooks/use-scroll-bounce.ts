import { useLayoutEffect, type RefObject } from "react";
import { animate, useMotionValue } from "motion/react";

const edgeTolerance = 1;
const maximumOffset = 40;
const releaseDelay = 80;

/** 返回边界外输入对应的内容位移方向；中段和未溢出的内容保持原生滚动。 */
function boundaryDirection(container: HTMLElement, delta: number) {
  const range = container.scrollHeight - container.clientHeight;
  if (range <= edgeTolerance || !Number.isFinite(delta) || delta === 0)
    return 0;
  if (delta < 0 && container.scrollTop <= edgeTolerance) return 1;
  if (delta > 0 && range - container.scrollTop <= edgeTolerance) return -1;
  return 0;
}

function inputPath(event: Event, container: HTMLElement) {
  const path: Element[] = [];
  for (const item of event.composedPath()) {
    if (item === container) break;
    if (item instanceof Element) path.push(item);
  }
  return path;
}

/** 内层控件保留自己的滚动和编辑行为，边界隔离也遵循内层容器的 CSS。 */
function isReservedInput(path: Element[], delta: number) {
  for (const element of path) {
    if (
      element.matches(
        'input, textarea, select, option, [role="slider"], [role="spinbutton"], [role="textbox"], [role="combobox"]',
      ) ||
      (element instanceof HTMLElement && element.isContentEditable) ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("contenteditable") === ""
    )
      return true;

    const style = getComputedStyle(element);
    const overflow = style.overflowY || style.overflow;
    if (!/^(auto|scroll|hidden|overlay)$/.test(overflow)) continue;
    const boundary =
      style.overscrollBehaviorY ||
      style.overscrollBehavior?.split(/\s+/).at(-1);
    if (boundary === "contain" || boundary === "none") return true;
    if (overflow === "hidden") continue;
    const range = element.scrollHeight - element.clientHeight;
    if (
      range > edgeTolerance &&
      ((delta < 0 && element.scrollTop > edgeTolerance) ||
        (delta > 0 && range - element.scrollTop > edgeTolerance))
    )
      return true;
  }
  return false;
}

function hasSelection() {
  return document.getSelection()?.isCollapsed === false;
}

/** 只为右侧内容添加边界反馈，不接管浏览器滚动或修改任何滚动位置。 */
export function useScrollBounce(
  container: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string,
) {
  const offset = useMotionValue(0);

  useLayoutEffect(() => {
    const target = container.current;
    offset.jump(0);
    if (!target || !enabled) return;
    const element = target;

    let alive = true;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    let animation: { stop: () => void } | undefined;
    const frames = new Set<number>();
    let touch: {
      identifier: number;
      y: number;
      originX: number;
      originY: number;
      axis: "vertical" | null;
    } | null = null;

    function stopRelease() {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      animation?.stop();
      animation = undefined;
    }
    function reset() {
      stopRelease();
      offset.jump(0);
    }
    function release() {
      stopRelease();
      if (!offset.get()) return;
      animation = animate(offset, 0, {
        type: "spring",
        stiffness: 290,
        damping: 28,
        mass: 0.7,
        restDelta: 0.1,
        restSpeed: 1,
      });
    }

    function feedback(
      event: Event,
      delta: number,
      wheel: boolean,
      gesture = touch,
    ) {
      const direction = boundaryDirection(element, delta);
      const reserved = isReservedInput(inputPath(event, element), delta);
      // 延后一帧，等待 React 委托事件处理完成后再尊重 defaultPrevented。
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        if (
          !alive ||
          event.defaultPrevented ||
          document.visibilityState === "hidden" ||
          hasSelection() ||
          (!wheel && gesture !== touch)
        )
          return;
        if (
          reserved ||
          direction === 0 ||
          direction !== boundaryDirection(element, delta)
        ) {
          reset();
          return;
        }
        stopRelease();
        const current = Math.max(0, offset.get() * direction);
        const resistance = 1 - current / maximumOffset;
        const distance = Math.min(Math.abs(delta), 160) * 0.2 * resistance;
        offset.set(direction * Math.min(maximumOffset, current + distance));
        if (wheel) releaseTimer = setTimeout(release, releaseDelay);
      });
      frames.add(frame);
    }

    function onWheel(event: WheelEvent) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.buttons !== 0 ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;
      feedback(event, event.deltaY * unit, true);
    }
    function onTouchStart(event: TouchEvent) {
      reset();
      const point = event.touches[0];
      touch =
        event.touches.length === 1 && point
          ? {
              identifier: point.identifier,
              y: point.clientY,
              originX: point.clientX,
              originY: point.clientY,
              axis: null,
            }
          : null;
    }
    function onTouchMove(event: TouchEvent) {
      const point = event.touches[0];
      if (
        !touch ||
        event.touches.length !== 1 ||
        point?.identifier !== touch.identifier
      ) {
        touch = null;
        reset();
        return;
      }
      const delta = touch.y - point.clientY;
      touch.y = point.clientY;
      if (!touch.axis) {
        const x = Math.abs(point.clientX - touch.originX);
        const y = Math.abs(point.clientY - touch.originY);
        if (Math.max(x, y) < 6) return;
        if (x >= y) {
          touch = null;
          return;
        }
        touch.axis = "vertical";
      }
      feedback(event, delta, false);
    }
    function onTouchEnd() {
      touch = null;
      release();
    }
    function onScroll() {
      const value = offset.get();
      if (
        (value > 0 && element.scrollTop > edgeTolerance) ||
        (value < 0 &&
          element.scrollHeight - element.clientHeight - element.scrollTop >
            edgeTolerance)
      )
        reset();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        touch = null;
        frames.forEach(cancelAnimationFrame);
        frames.clear();
        reset();
      }
    }

    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    element.addEventListener("touchcancel", onTouchEnd, { passive: true });
    element.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      frames.forEach(cancelAnimationFrame);
      reset();
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
      element.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [container, enabled, offset, resetKey]);

  return offset;
}

import { useLayoutEffect, type RefObject } from "react";
import { animate, useMotionValue } from "motion/react";

const edgeTolerance = 1;
const maximumOffset = 56;

type TouchGesture = {
  identifier: number;
  y: number;
  originX: number;
  originY: number;
  axis: "vertical" | null;
};

/** 返回边界外输入的方向；不足一屏时，上下两个边界均可拉伸。 */
function boundaryDirection(container: HTMLElement, delta: number) {
  const range = Math.max(0, container.scrollHeight - container.clientHeight);
  if (!Number.isFinite(delta) || delta === 0) return 0;
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
    let animation: { stop: () => void } | undefined;
    let frame: number | undefined;
    let touch: TouchGesture | null = null;
    const pending: {
      event: Event;
      delta: number;
      wheel: boolean;
      gesture: TouchGesture | null;
      direction: number;
      reserved: boolean;
    }[] = [];

    function stopAnimation() {
      animation?.stop();
      animation = undefined;
    }
    function cancelFeedback() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pending.length = 0;
    }
    function reset() {
      stopAnimation();
      offset.jump(0);
    }
    function release() {
      stopAnimation();
      if (!offset.get()) return;
      animation = animate(offset, 0, {
        type: "spring",
        stiffness: 650,
        damping: 30,
        mass: 0.35,
        velocity: 0,
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
      pending.push({
        event,
        delta,
        wheel,
        gesture,
        direction: boundaryDirection(element, delta),
        reserved: isReservedInput(inputPath(event, element), delta),
      });
      if (frame !== undefined) return;
      // 等待委托处理完成，并把同帧输入合并为一次动画，避免高频尾流反复重启。
      frame = requestAnimationFrame(() => {
        frame = undefined;
        let value = offset.get();
        let updated = false;
        let shouldRelease = false;
        for (const input of pending.splice(0)) {
          if (
            !alive ||
            input.event.defaultPrevented ||
            document.visibilityState === "hidden" ||
            hasSelection() ||
            (!input.wheel && input.gesture !== touch)
          )
            continue;
          if (
            input.reserved ||
            input.direction === 0 ||
            input.direction !== boundaryDirection(element, input.delta)
          ) {
            value = 0;
            updated = true;
            shouldRelease = false;
            continue;
          }
          // 反向输入先收回已有位移，短页面也不会在小幅回拖时突然翻向。
          const resistance =
            value * input.direction >= 0
              ? 1 - Math.abs(value) / maximumOffset
              : 1;
          const distance = Math.min(Math.abs(input.delta), 160) * 0.35;
          value = Math.max(
            -maximumOffset,
            Math.min(
              maximumOffset,
              value + input.direction * distance * resistance,
            ),
          );
          updated = true;
          shouldRelease = input.wheel;
        }
        if (!updated) return;
        stopAnimation();
        offset.set(value);
        // 滚轮始终即时回收，不让惯性尾流延长等待；触摸则保持到抬手。
        if (shouldRelease) release();
      });
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
      cancelFeedback();
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
          Math.max(0, element.scrollHeight - element.clientHeight) -
            element.scrollTop >
            edgeTolerance)
      )
        reset();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        touch = null;
        cancelFeedback();
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
      cancelFeedback();
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

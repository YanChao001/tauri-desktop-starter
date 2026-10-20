import { useLayoutEffect, type RefObject } from "react";
import { animate, useMotionValue } from "motion/react";

const maximumOffset = 56;

function boundaryDirection(element: HTMLElement, delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const range = Math.max(0, element.scrollHeight - element.clientHeight);
  if (delta < 0 && element.scrollTop <= 1) return 1;
  if (delta > 0 && range - element.scrollTop <= 1) return -1;
  return 0;
}

/** 编辑控件和内层滚动区域自行处理手势。 */
function isReserved(event: Event, container: HTMLElement) {
  if (
    document.visibilityState === "hidden" ||
    document.getSelection()?.isCollapsed === false
  )
    return true;
  for (const element of event.composedPath()) {
    if (element === container) break;
    if (!(element instanceof HTMLElement)) continue;
    if (
      element.matches(
        'input, textarea, select, [role="slider"], [role="spinbutton"], [role="textbox"], [role="combobox"]',
      ) ||
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true"
    )
      return true;
    const style = getComputedStyle(element);
    if (
      /^(auto|scroll|hidden)$/.test(style.overflowY) &&
      (element.scrollHeight > element.clientHeight + 1 ||
        /^(contain|none)$/.test(style.overscrollBehaviorY))
    )
      return true;
  }
  return false;
}

/** 滚轮每轮手势播放一次回弹；触摸直接跟手，抬手后复位。 */
export function useScrollBounce(
  container: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string,
) {
  const offset = useMotionValue(0);
  useLayoutEffect(() => {
    offset.jump(0);
    const target = container.current;
    if (!target || !enabled) return;
    const element = target;
    let animation: { stop(): void } | undefined;
    let frame = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let wheelDirection = 0;
    let touch: {
      x: number;
      y: number;
      previousY: number;
      pull: number;
      vertical: boolean;
    } | null = null;

    function cancelFrame() {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    function reset() {
      cancelFrame();
      clearTimeout(wheelTimer);
      wheelTimer = undefined;
      animation?.stop();
      offset.jump(0);
      if (touch) touch.pull = 0;
    }
    function afterDispatch(event: Event, update: () => void) {
      cancelFrame();
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!event.defaultPrevented) update();
      });
    }
    function keepWheelSession() {
      clearTimeout(wheelTimer);
      // 只用于区分两轮输入；动画会独立完成，不等这个计时器。
      wheelTimer = setTimeout(() => {
        wheelTimer = undefined;
      }, 140);
    }
    function onWheel(event: WheelEvent) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.buttons ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      const direction = boundaryDirection(element, event.deltaY);
      if (wheelTimer !== undefined && direction === wheelDirection) {
        keepWheelSession();
        return;
      }
      if (!direction || isReserved(event, element)) return;
      keepWheelSession();
      wheelDirection = direction;
      afterDispatch(event, () => {
        animation?.stop();
        animation = animate(offset, [offset.get(), direction * 40, 0], {
          type: "tween",
          duration: 0.2,
          times: [0, 0.25, 1],
          ease: "easeOut",
        });
      });
    }
    function onTouchStart(event: TouchEvent) {
      reset();
      const point = event.touches[0];
      touch =
        event.touches.length === 1 && point && !isReserved(event, element)
          ? {
              x: point.clientX,
              y: point.clientY,
              previousY: point.clientY,
              pull: 0,
              vertical: false,
            }
          : null;
    }
    function onTouchMove(event: TouchEvent) {
      const point = event.touches[0];
      if (!touch || event.touches.length !== 1 || !point) {
        onTouchEnd();
        return;
      }
      const gesture = touch;
      const delta = gesture.previousY - point.clientY;
      gesture.previousY = point.clientY;
      if (!gesture.vertical) {
        const x = Math.abs(point.clientX - gesture.x),
          y = Math.abs(point.clientY - gesture.y);
        if (Math.max(x, y) < 6) return;
        if (x >= y) {
          touch = null;
          return;
        }
        gesture.vertical = true;
      }
      if (!delta) return;
      if (!boundaryDirection(element, delta)) {
        gesture.pull = 0;
        cancelFrame();
        offset.jump(0);
        return;
      }
      gesture.pull -= delta;
      afterDispatch(event, () => {
        if (touch === gesture)
          offset.set(
            (maximumOffset * gesture.pull) / (160 + Math.abs(gesture.pull)),
          );
      });
    }
    function onTouchEnd() {
      touch = null;
      cancelFrame();
      animation?.stop();
      if (offset.get())
        animation = animate(offset, 0, {
          type: "tween",
          duration: 0.14,
          ease: "easeOut",
        });
    }
    function onScroll() {
      const value = offset.get();
      if (value && boundaryDirection(element, -Math.sign(value)) === 0) reset();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        touch = null;
        reset();
      }
    }
    const controller = new AbortController();
    const options = { passive: true, signal: controller.signal };
    element.addEventListener("wheel", onWheel, options);
    element.addEventListener("touchstart", onTouchStart, options);
    element.addEventListener("touchmove", onTouchMove, options);
    element.addEventListener("touchend", onTouchEnd, options);
    element.addEventListener("touchcancel", onTouchEnd, options);
    element.addEventListener("scroll", onScroll, options);
    document.addEventListener("visibilitychange", onVisibilityChange, options);
    return () => {
      touch = null;
      reset();
      controller.abort();
    };
  }, [container, enabled, offset, resetKey]);
  return offset;
}

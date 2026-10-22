import { useRef, type KeyboardEvent } from "react";
import "@/styles/experience.css";

/** 指针与键盘共用同一组尺寸约束，拖动只捕获当前指针。 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ x: number; value: number; pointer: number } | null>(
    null,
  );
  const change = (next: number) =>
    onChange(Math.round(Math.max(min, Math.min(max, next))));
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowLeft"
        ? value - 10
        : event.key === "ArrowRight"
          ? value + 10
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    change(next);
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className="demo-resize-handle"
      onKeyDown={key}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, value, pointer: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer === event.pointerId)
          change(drag.current.value + event.clientX - drag.current.x);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}

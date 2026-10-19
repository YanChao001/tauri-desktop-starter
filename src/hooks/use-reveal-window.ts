import { useEffect } from "react";
import { revealWindow } from "@/lib/tauri";

/**
 * 窗口默认隐藏（见 tauri.conf.json），首帧绘制完成后由前端主动显示。
 *
 * 等两帧而不是在 effect 里直接调用：useEffect 的时机不保证在 paint 之后，
 * 提前 show() 仍可能闪一下空白窗口。Rust 侧另有 3 秒兜底，
 * 防止前端异常导致窗口永不出现。
 */
export function useRevealWindow(): void {
  useEffect(() => {
    let cancelled = false;
    let inner = 0;

    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!cancelled) void revealWindow();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
}

import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { useSettings } from "@/providers/settings";
import { useCallback } from "react";
import { THEMES, type AppTheme } from "@/lib/settings-model";

type ViewTransitionHandle = { ready: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionHandle;
};

/**
 * 从鼠标位置扩散切换主题。
 *
 * 用 View Transitions API 给新旧两帧做圆形裁剪；不支持或关闭动效时
 * 直接执行，不阻塞主题切换。
 */
function switchThemeWithReveal(
  point: { clientX: number; clientY: number },
  applyTheme: () => void,
  animated: boolean,
) {
  const doc = document as ViewTransitionDocument;

  if (
    !animated ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    typeof doc.startViewTransition !== "function" ||
    typeof document.documentElement.animate !== "function"
  ) {
    applyTheme();
    return;
  }

  const { clientX: x, clientY: y } = point;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = doc.startViewTransition(() => {
    // 主题属于 React 状态，必须同步提交，View Transition 才能捕获新帧
    flushSync(applyTheme);
  });

  void transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 520,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // 连续切换或窗口隐藏会跳过过渡并拒绝 ready，主题本身已经提交
    });
}

/**
 * 统一的主题切换入口：圆形扩散动画由设置里的动效开关决定。
 */
export function useThemeSwitch() {
  const { setTheme: applyTheme, resolvedTheme } = useTheme();
  const { settings, update } = useSettings();
  const setTheme = useCallback(
    (value: string) => {
      if (!THEMES.includes(value as AppTheme)) return;
      update({ theme: value as AppTheme });
      applyTheme(value);
    },
    [update, applyTheme],
  );

  function toggle(event: { clientX: number; clientY: number }) {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    switchThemeWithReveal(
      event,
      () => setTheme(next),
      settings.motion === "full",
    );
  }

  return { theme: settings.theme, setTheme, resolvedTheme, toggle };
}

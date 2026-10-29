import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { useSettings } from "@/providers/settings";
import { useCallback, useEffect, useRef } from "react";
import { THEMES, THEME_STORAGE_KEY, type AppTheme } from "@/lib/settings-model";
import { isTauri } from "@/lib/tauri";

type ViewTransitionHandle = {
  ready: Promise<void>;
  skipTransition?: () => void;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionHandle;
};
export const THEME_REVEAL_EVENT = "starter:theme-reveal";
export type ThemeReveal = {
  id: number;
  clientX: number;
  clientY: number;
  radius: number;
  duration: number;
  easing: string;
  startedAt: number;
};
let revealSequence = 0;
let cancelActiveReveal: (() => void) | undefined;

function themeControlPoint() {
  const rectangle = document
    .querySelector("[data-theme-control]")
    ?.getBoundingClientRect();
  return rectangle?.width && rectangle.height
    ? {
        clientX: rectangle.left + rectangle.width / 2,
        clientY: rectangle.top + rectangle.height / 2,
      }
    : { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
}

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
  onCancel?: () => void,
) {
  cancelActiveReveal?.();
  const doc = document as ViewTransitionDocument;

  if (
    !animated ||
    document.visibilityState === "hidden" ||
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
  const reveal: ThemeReveal = {
    id: ++revealSequence,
    clientX: x,
    clientY: y,
    radius,
    duration: 520,
    easing: "ease-in-out",
    startedAt: performance.timeOrigin + performance.now(),
  };
  // 不透明子框架先捕获自己的旧文档，再由宿主改变主题。
  window.dispatchEvent(new CustomEvent(THEME_REVEAL_EVENT, { detail: reveal }));

  let cancelled = false;
  let committed = false;
  let animation: Animation | undefined;
  const commit = () => {
    // 主题属于 React 状态，必须同步提交，View Transition 才能捕获新帧。
    if (!cancelled && !committed) {
      committed = true;
      flushSync(applyTheme);
    }
  };
  const transition = doc.startViewTransition(commit);
  const release = () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (cancelActiveReveal === cancel) cancelActiveReveal = undefined;
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    transition.skipTransition?.();
    animation?.cancel();
    release();
    onCancel?.();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState !== "hidden") return;
    // 隐藏时仍提交已选择的主题，只终止视觉过渡。
    commit();
    cancel();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  cancelActiveReveal = cancel;

  void transition.ready
    .then(() => {
      if (cancelled || document.visibilityState === "hidden") return;
      animation = document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: reveal.duration,
          easing: reveal.easing,
          pseudoElement: "::view-transition-new(root)",
        },
      );
      if (animation)
        animation.currentTime = Math.max(
          0,
          performance.timeOrigin + performance.now() - reveal.startedAt,
        );
      void animation?.finished?.then(release, release);
    })
    .catch(() => {
      // 连续切换或窗口隐藏会跳过过渡并拒绝 ready，主题本身已经提交
      release();
    });
  return cancel;
}

/** 主窗口和独立插件窗口共享同步入口，不向原生回写远端设置。 */
export function useSynchronizedTheme() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { settings, persistence } = useSettings();
  const native = isTauri();
  const hydrated = useRef(false);
  const pending = useRef<(() => void) | undefined>(undefined);
  const pendingTheme = useRef<AppTheme | undefined>(undefined);
  useEffect(() => {
    // 主题缓存只用于首屏；运行时始终由当前设置模型提交。
    // 否则浏览器标签页会按各自偏好纠正远端缓存，形成反复改色与回写。
    // 原生窗口同样等待 SettingsSync 接受 revision 后再同步主题。
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) event.stopImmediatePropagation();
    };
    window.addEventListener("storage", onStorage, true);
    return () => window.removeEventListener("storage", onStorage, true);
  }, []);
  useEffect(() => {
    const ready = !native || persistence !== "loading";
    if (pendingTheme.current && pendingTheme.current !== settings.theme) {
      pending.current?.();
      pending.current = undefined;
      pendingTheme.current = undefined;
    }
    if (theme !== settings.theme) {
      pendingTheme.current = settings.theme;
      const nextResolved =
        settings.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : settings.theme;
      pending.current = switchThemeWithReveal(
        themeControlPoint(),
        () => setTheme(settings.theme),
        hydrated.current &&
          ready &&
          settings.motion === "full" &&
          nextResolved !== resolvedTheme,
      );
    }
    hydrated.current = ready;
  }, [
    theme,
    resolvedTheme,
    settings.theme,
    settings.motion,
    persistence,
    setTheme,
    native,
  ]);
  useEffect(
    () => () => {
      pending.current?.();
    },
    [],
  );
}

/**
 * 统一的主题切换入口：圆形扩散动画由设置里的动效开关决定。
 */
export function useThemeSwitch() {
  const { setTheme: applyTheme, resolvedTheme } = useTheme();
  const { settings, update } = useSettings();
  const pending = useRef<(() => void) | undefined>(undefined);
  const pendingTheme = useRef<"light" | "dark" | undefined>(undefined);
  useEffect(() => () => pending.current?.(), []);
  const commitTheme = useCallback(
    (value: AppTheme) => {
      update({ theme: value });
      applyTheme(value);
    },
    [update, applyTheme],
  );
  const setTheme = useCallback(
    (value: string) => {
      if (!THEMES.includes(value as AppTheme)) return;
      // 明确选择优先于尚未提交的动画，避免旧切换稍后覆盖新值。
      cancelActiveReveal?.();
      commitTheme(value as AppTheme);
    },
    [commitTheme],
  );

  function toggle(event: { clientX: number; clientY: number }) {
    const next =
      (pendingTheme.current ?? resolvedTheme) === "dark" ? "light" : "dark";
    pendingTheme.current = next;
    pending.current = switchThemeWithReveal(
      event,
      () => {
        commitTheme(next);
        if (pendingTheme.current === next) pendingTheme.current = undefined;
      },
      settings.motion === "full",
      () => {
        if (pendingTheme.current === next) pendingTheme.current = undefined;
      },
    );
  }

  return { theme: settings.theme, setTheme, resolvedTheme, toggle };
}

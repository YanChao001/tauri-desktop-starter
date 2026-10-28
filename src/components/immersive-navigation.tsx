import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MenuIcon, PanelLeftIcon } from "lucide-react";
import { useI18n } from "@/providers/i18n";

type Edge = "top" | "left";
const panelIds = { top: "app-chrome", left: "app-sidebar" } as const;

/** 沉浸模式的临时导航，不修改侧栏偏好，也不占据正文布局。 */
export function ImmersiveNavigation() {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState({ top: false, left: false });
  const current = useRef(revealed);
  const timers = useRef<Partial<Record<Edge, number>>>({});
  const focusFrame = useRef<number | null>(null);
  const reveal = useCallback((edge: Edge) => {
    window.clearTimeout(timers.current[edge]);
    delete timers.current[edge];
    if (current.current[edge]) return;
    current.current = { ...current.current, [edge]: true };
    setRevealed(current.current);
  }, []);

  useLayoutEffect(() => {
    // 进入全屏时将旧导航焦点交给正文，避免菜单关闭后仍撑开标题栏。
    if (document.activeElement?.closest("#app-chrome, #app-sidebar"))
      document
        .querySelector<HTMLElement>(".app-main")
        ?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const panels = {
      top: document.getElementById(panelIds.top)!,
      left: document.getElementById(panelIds.left)!,
    };
    const edges = {
      top: document.querySelector<HTMLElement>(
        '.immersive-edge[data-edge="top"]',
      )!,
      left: document.querySelector<HTMLElement>(
        '.immersive-edge[data-edge="left"]',
      )!,
    };
    const hovered = new Set<HTMLElement>();
    let pointerEdge: Edge | null = null;
    const edgeAt = (event: PointerEvent, boundary = false): Edge | null => {
      // 系统顶边与 WebView 客户区交接允许 1px 舍入误差，不扩大正常唤出区。
      const outside = 1;
      const depth = boundary ? 1 : 10;
      if (
        event.clientX >= 0 &&
        event.clientX < window.innerWidth &&
        event.clientY >= -outside &&
        event.clientY <= depth
      )
        return "top";
      if (
        event.clientY > 10 &&
        event.clientY < window.innerHeight &&
        event.clientX >= -outside &&
        event.clientX <= depth
      )
        return "left";
      return null;
    };

    const retained = (edge: Edge) => {
      const panel = panels[edge];
      return (
        pointerEdge === edge ||
        hovered.has(panel) ||
        hovered.has(edges[edge]) ||
        edges[edge] === document.activeElement ||
        (current.current[edge] &&
          (panel.matches(":focus-within, [data-resizing='true']") ||
            // 菜单和选择列表通过 Portal 绘制，触发器仍保留展开状态。
            !!panel.querySelector('[aria-haspopup][aria-expanded="true"]')))
      );
    };
    const hideLater = (edge: Edge) => {
      if (!current.current[edge] || timers.current[edge] !== undefined) return;
      timers.current[edge] = window.setTimeout(() => {
        delete timers.current[edge];
        if (retained(edge)) return;
        current.current = { ...current.current, [edge]: false };
        setRevealed(current.current);
      }, 280);
    };
    const reconcile = () => {
      for (const edge of ["top", "left"] as const) {
        if (retained(edge)) reveal(edge);
        else hideLater(edge);
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerEdge = edgeAt(event);
      if (pointerEdge) reveal(pointerEdge);
      reconcile();
    };
    const focus = () => {
      // Radix 关闭进入全屏的菜单后可能晚到地还焦点；不重新打开已收起的栏。
      for (const edge of ["top", "left"] as const)
        if (
          !current.current[edge] &&
          panels[edge].contains(document.activeElement)
        ) {
          document
            .querySelector<HTMLElement>(".app-main")
            ?.focus({ preventScroll: true });
          return;
        }
      reconcile();
    };
    const leaveWindow = (event: PointerEvent) => {
      hovered.clear();
      const boundary =
        event.pointerType === "touch" ? null : edgeAt(event, true);
      // 停在最外侧像素仍算贴边，不能仅凭 pointerleave 就启动收起。
      pointerEdge = boundary && current.current[boundary] ? boundary : null;
      reconcile();
    };
    const blurWindow = () => {
      pointerEdge = null;
      hovered.clear();
      reconcile();
    };
    const observer = new MutationObserver(reconcile);
    const unsubscribe: (() => void)[] = [];
    for (const edge of ["top", "left"] as const) {
      observer.observe(panels[edge], {
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-expanded", "data-resizing"],
      });
      for (const node of [panels[edge], edges[edge]]) {
        const enter = (event: PointerEvent) => {
          if (event.pointerType === "touch") return;
          hovered.add(node);
          reveal(edge);
        };
        const leave = (event: PointerEvent) => {
          // iframe 有独立事件树，不依赖父文档的 pointermove 或 :hover 状态。
          hovered.delete(node);
          if (event.pointerType !== "touch") pointerEdge = edgeAt(event);
          reconcile();
        };
        node.addEventListener("pointerenter", enter);
        node.addEventListener("pointerleave", leave);
        unsubscribe.push(() => {
          node.removeEventListener("pointerenter", enter);
          node.removeEventListener("pointerleave", leave);
        });
      }
    }
    document.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leaveWindow);
    window.addEventListener("blur", blurWindow);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", reconcile);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leaveWindow);
      window.removeEventListener("blur", blurWindow);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", reconcile);
      for (const stop of unsubscribe) stop();
      for (const timer of Object.values(timers.current))
        window.clearTimeout(timer);
      timers.current = {};
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, [reveal]);

  const focusPanel = (edge: Edge) => {
    reveal(edge);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    // 先让展开样式完成一帧绘制，再移焦，避免触屏点击时目标仍是 hidden。
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        const controls = document
          .getElementById(panelIds[edge])
          ?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], [tabindex="0"]',
          );
        Array.from(controls ?? [])
          .find((control) => control.getClientRects().length > 0)
          ?.focus({ preventScroll: true });
      });
    });
  };

  return (
    <>
      {(["top", "left"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          className="immersive-edge"
          data-edge={edge}
          aria-label={t(
            edge === "top" ? "title.showChrome" : "title.showNavigation",
          )}
          aria-controls={panelIds[edge]}
          aria-expanded={revealed[edge]}
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") reveal(edge);
          }}
          onFocus={() => reveal(edge)}
          onClick={() => focusPanel(edge)}
        >
          {edge === "top" ? <MenuIcon /> : <PanelLeftIcon />}
        </button>
      ))}
    </>
  );
}

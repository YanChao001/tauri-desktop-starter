import { useCallback, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { APP_CONFIG } from "@/config/app";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isTauri } from "@/lib/tauri";
import { useCommands } from "@/providers/commands";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import type { AppRoute } from "@/routes";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 224;
export function clampSidebarWidth(value: number) {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value)),
  );
}

export function AppSidebar({ routes }: { routes: readonly AppRoute[] }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { execute } = useCommands();
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeHandle = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      drag.current = null;
      setResizing(false);
    }
  }, []);
  const collapsed = settings.sidebarCollapsed;
  const width = settings.sidebarWidth;
  const resize = (value: number) =>
    update({ sidebarWidth: clampSidebarWidth(value) });
  return (
    <aside
      id="app-sidebar"
      aria-label={t("layout.sidebar")}
      data-collapsed={collapsed}
      data-resizing={resizing}
      data-motion={settings.motion}
      style={{ width: collapsed ? 56 : width }}
      className="app-sidebar relative flex shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground"
    >
      <div className="relative flex h-12 shrink-0 items-center px-4">
        <span
          aria-hidden={collapsed}
          className="app-sidebar-label min-w-0 flex-1 truncate pr-10 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {APP_CONFIG.name}
        </span>
        <Button
          className="absolute right-3.5"
          variant="ghost"
          size="icon-sm"
          aria-label={t(
            collapsed ? "layout.expandSidebar" : "layout.collapseSidebar",
          )}
          aria-controls="app-sidebar-navigation"
          aria-expanded={!collapsed}
          onClick={() => void execute("toggle-sidebar")}
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </Button>
      </div>
      <nav
        id="app-sidebar-navigation"
        className="flex-1 space-y-0.5 overflow-y-auto p-2"
      >
        {routes.map(({ path, labelKey, icon: Icon, exact }) => (
          <Tooltip key={path}>
            <TooltipTrigger asChild>
              <NavLink
                to={path}
                end={exact}
                className="flex h-9 items-center gap-2.5 overflow-hidden rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="app-sidebar-label min-w-0 flex-1 truncate">
                  {t(labelKey)}
                </span>
              </NavLink>
            </TooltipTrigger>
            {collapsed ? (
              <TooltipContent side="right">{t(labelKey)}</TooltipContent>
            ) : null}
          </Tooltip>
        ))}
      </nav>
      <div
        aria-hidden={collapsed}
        className="app-sidebar-footer shrink-0 border-t border-sidebar-border text-xs text-muted-foreground"
      >
        <div className="min-h-0 space-y-1 overflow-hidden">
          {settings.appMode === "demo" ? <p>Tauri 2 · React 19</p> : null}
          <p>{isTauri() ? t("app.native") : t("app.preview")}</p>
        </div>
      </div>
      {!collapsed ? (
        <div
          ref={resizeHandle}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("layout.resizeSidebar")}
          aria-controls="app-sidebar"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          aria-valuetext={`${width}px`}
          title={t("layout.resetSidebarWidth")}
          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none outline-none focus-visible:bg-primary/30"
          onDoubleClick={() => resize(SIDEBAR_DEFAULT_WIDTH)}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const step = event.shiftKey ? 32 : 8;
            const next =
              event.key === "ArrowLeft"
                ? width - step
                : event.key === "ArrowRight"
                  ? width + step
                  : event.key === "Home"
                    ? SIDEBAR_MIN_WIDTH
                    : event.key === "End"
                      ? SIDEBAR_MAX_WIDTH
                      : event.key === "Enter"
                        ? SIDEBAR_DEFAULT_WIDTH
                        : null;
            if (next === null) return;
            event.preventDefault();
            resize(next);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            const renderedWidth =
              event.currentTarget.parentElement?.getBoundingClientRect().width;
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              width:
                renderedWidth && renderedWidth >= SIDEBAR_MIN_WIDTH
                  ? renderedWidth
                  : width,
            };
            setResizing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (state?.id === event.pointerId)
              resize(state.width + event.clientX - state.x);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setResizing(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setResizing(false);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setResizing(false);
          }}
        />
      ) : null}
    </aside>
  );
}

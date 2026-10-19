import { useRef } from "react";
import { NavLink } from "react-router-dom";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { APP_CONFIG } from "@/config/app";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
  const collapsed = settings.sidebarCollapsed;
  const width = settings.sidebarWidth;
  const resize = (value: number) =>
    update({ sidebarWidth: clampSidebarWidth(value) });
  return (
    <aside
      id="app-sidebar"
      aria-label={t("layout.sidebar")}
      data-collapsed={collapsed}
      style={{ width: collapsed ? 56 : width }}
      className="app-sidebar relative flex shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground"
    >
      <div
        className={cn(
          "flex h-12 items-center gap-2 px-2",
          collapsed ? "justify-center" : "justify-between pl-4",
        )}
      >
        {!collapsed ? (
          <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {APP_CONFIG.name}
          </span>
        ) : null}
        <Button
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
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground",
                  collapsed ? "justify-center px-0" : "px-2.5",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className={cn("truncate", collapsed && "sr-only")}>
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
      {!collapsed ? (
        <div className="space-y-1 border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
          {settings.appMode === "demo" ? <p>Tauri 2 · React 19</p> : null}
          <p>{isTauri() ? t("app.native") : t("app.preview")}</p>
        </div>
      ) : null}
      {!collapsed ? (
        <div
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
            drag.current = { id: event.pointerId, x: event.clientX, width };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (state?.id === event.pointerId)
              resize(state.width + event.clientX - state.x);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      ) : null}
    </aside>
  );
}

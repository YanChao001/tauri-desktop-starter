import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
} from "lucide-react";
import { formatShortcut } from "@/commands/shortcuts";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isMacOS } from "@/lib/platform";
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/lib/settings-model";
import { useCommands } from "@/providers/commands";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { NAVIGATION_GROUPS, type AppRoute } from "@/routes";

export function AppSidebar({ routes }: { routes: readonly AppRoute[] }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { execute } = useCommands();
  const { pathname } = useLocation();
  const navigationId = useId();
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const tooltipIntent = useRef<string | null>(null);
  const resizeHandle = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      drag.current = null;
      setResizing(false);
    }
  }, []);
  const collapsed = settings.sidebarCollapsed;
  const width = settings.sidebarWidth;
  // 展开时的隐藏 Tooltip 不积累 open 状态；折叠、切页和调宽先清空提示。
  useLayoutEffect(() => {
    tooltipIntent.current = null;
    setTooltip(null);
  }, [collapsed, pathname, width]);
  const tooltipChanged = (id: string, open: boolean) => {
    if (open && (!collapsed || tooltipIntent.current !== id)) return;
    setTooltip((current) => (open ? id : current === id ? null : current));
  };
  const trackTooltip = (id: string) => {
    if (collapsed) tooltipIntent.current = id;
  };
  const leaveTooltip = (id: string) => {
    if (tooltipIntent.current === id) tooltipIntent.current = null;
  };
  const resize = (value: number) => update({ sidebarWidth: value });
  const groups = NAVIGATION_GROUPS.map((group) => ({
    ...group,
    routes: routes.filter((route) => route.group === group.id),
  })).filter((group) => group.routes.length > 0);
  return (
    <aside
      id="app-sidebar"
      aria-label={t("layout.sidebar")}
      data-collapsed={collapsed}
      data-resizing={resizing}
      data-motion={settings.motion}
      style={{ width: collapsed ? 56 : width }}
      className="app-sidebar flex shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground"
    >
      <div className="app-sidebar-top relative flex shrink-0 items-center">
        <span
          aria-hidden={collapsed}
          className="app-sidebar-label app-sidebar-caption min-w-0 flex-1 truncate"
        >
          {t("navContext.browse")}
        </span>
        <Button
          className="absolute right-3"
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
        className="app-sidebar-navigation app-scroll-region min-h-0 flex-1 overflow-y-auto"
        onWheel={() => {
          tooltipIntent.current = null;
          setTooltip(null);
        }}
        onScroll={() => {
          tooltipIntent.current = null;
          setTooltip(null);
        }}
      >
        {groups.map((group) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`${navigationId}-${group.id}`}
            className="app-sidebar-group"
          >
            <p
              id={`${navigationId}-${group.id}`}
              className="app-sidebar-group-heading"
            >
              <span className="app-sidebar-label">{t(group.labelKey)}</span>
            </p>
            <div className="space-y-0.5">
              {group.routes.map(
                ({ path, labelKey, icon: Icon, exact, preload }) => (
                  <Tooltip
                    key={path}
                    open={collapsed && tooltip === path}
                    onOpenChange={(open) => tooltipChanged(path, open)}
                  >
                    <TooltipTrigger asChild>
                      <NavLink
                        to={path}
                        end={exact}
                        className="app-sidebar-link flex h-9 items-center gap-2.5 overflow-hidden rounded-lg px-3 text-sm"
                        onPointerEnter={preload}
                        onPointerMove={() => trackTooltip(path)}
                        onFocus={() => {
                          trackTooltip(path);
                          preload?.();
                        }}
                        onPointerLeave={() => leaveTooltip(path)}
                        onBlur={() => leaveTooltip(path)}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="app-sidebar-label min-w-0 flex-1 truncate">
                          {t(labelKey)}
                        </span>
                      </NavLink>
                    </TooltipTrigger>
                    {collapsed && tooltip === path ? (
                      <TooltipContent side="right" className="space-y-0.5">
                        <p className="text-[10px] opacity-65">
                          {t(group.labelKey)}
                        </p>
                        <p>{t(labelKey)}</p>
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                ),
              )}
            </div>
          </div>
        ))}
      </nav>
      <div className="app-sidebar-tools shrink-0">
        <Tooltip
          open={collapsed && tooltip === "commands"}
          onOpenChange={(open) => tooltipChanged("commands", open)}
        >
          <TooltipTrigger asChild>
            <button
              type="button"
              className="app-sidebar-command flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-3"
              aria-label={`${t("navContext.commands")} ${formatShortcut({ key: "k", primary: true })}`}
              aria-keyshortcuts={isMacOS() ? "Meta+K" : "Control+K"}
              onClick={() => void execute("command-palette")}
              onPointerMove={() => trackTooltip("commands")}
              onFocus={() => trackTooltip("commands")}
              onPointerLeave={() => leaveTooltip("commands")}
              onBlur={() => leaveTooltip("commands")}
            >
              <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="app-sidebar-label min-w-0 flex-1 truncate text-left">
                {t("navContext.commands")}
              </span>{" "}
              <kbd className="app-sidebar-keycap" aria-hidden="true">
                {formatShortcut({ key: "k", primary: true })}
              </kbd>
            </button>
          </TooltipTrigger>
          {collapsed && tooltip === "commands" ? (
            <TooltipContent side="right">
              {t("navContext.commands")} ·{" "}
              {formatShortcut({ key: "k", primary: true })}
            </TooltipContent>
          ) : null}
        </Tooltip>
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

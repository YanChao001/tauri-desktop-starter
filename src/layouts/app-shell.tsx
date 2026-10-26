import { Suspense, useLayoutEffect, useRef, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChevronRightIcon, MinimizeIcon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { TitleBar } from "@/components/title-bar";
import { WindowBackground } from "@/components/window-background";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { useCommands } from "@/providers/commands";
import { Button } from "@/components/ui/button";
import {
  APP_ROUTES,
  NAVIGATION_GROUPS,
  extensionNavigation,
  matchRoute,
} from "@/routes";
import { useExtensions } from "@/features/extensions/extensions-provider";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { JourneyGuide } from "@/features/journeys/journey-guide";
import { currentJourney } from "@/features/journeys/model";
import { useAppChrome } from "@/hooks/use-app-chrome";
import "@/styles/app-navigation.css";
import { ExtensionChromeProvider } from "@/features/extensions/extension-chrome-slot";

/** 感知路由的应用布局；页面失败时保留导航能力 */
export function AppShell() {
  const { pathname, search } = useLocation();
  const { data } = useExtensions();
  const extensionRoutes = extensionNavigation(data?.items ?? [], pathname);
  const dynamicRoute = extensionRoutes.find((route) => route.path === pathname);
  const extensionSurface = pathname.startsWith("/extensions/app/");
  const current = dynamicRoute ?? matchRoute(pathname);
  const group =
    NAVIGATION_GROUPS.find(({ id }) => id === current.group) ??
    NAVIGATION_GROUPS[0];
  const { t } = useI18n();
  const { settings } = useSettings();
  const { fullscreen, execute } = useCommands();
  const routes = [
    ...APP_ROUTES.filter(
      (route) =>
        !route.hidden && (settings.appMode !== "minimal" || !route.demoOnly),
    ),
    ...extensionRoutes,
  ];
  const chrome = useAppChrome();
  const content = useRef<HTMLElement>(null);
  const journeyStep = currentJourney(pathname, search)?.index;

  useLayoutEffect(() => {
    // 仅切换页面时重置滚动；设置搜索可能在当前路径内主动聚焦字段
    // 导航更新不应覆盖该焦点
    if (content.current) {
      content.current.scrollTop = 0;
      content.current.scrollLeft = 0;
    }
  }, [pathname, journeyStep]);

  return (
    <ExtensionChromeProvider scope={pathname}>
      <div
        className={cn(
          "app-shell text-foreground",
          !isTauri() && "app-shell-browser",
          fullscreen && "app-shell-immersive",
        )}
        style={
          {
            "--app-sidebar-width": `${settings.sidebarCollapsed ? 56 : settings.sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <WindowBackground />
        {fullscreen ? (
          <div className="immersive-exit">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void execute("exit-fullscreen")}
              aria-label={t("title.exitFullscreen")}
              aria-keyshortcuts="F11 Escape"
              title={t("title.fullscreenHint")}
            >
              <MinimizeIcon className="size-3.5" />
              <span>{t("title.exitFullscreen")}</span>
              <kbd>F11 / Esc</kbd>
            </Button>
          </div>
        ) : null}
        <div ref={chrome} className="app-chrome">
          <TitleBar />
        </div>
        <AppSidebar routes={routes} />
        <main
          ref={content}
          className="app-main app-scroll-region"
          tabIndex={-1}
        >
          <div className="app-page-content">
            {!extensionSurface ? (
              <nav
                aria-label={t("navContext.location")}
                className="app-route-context"
              >
                <ol>
                  <li className="app-route-context-group">
                    <span
                      className="app-route-context-dot"
                      aria-hidden="true"
                    />
                    {t(group.labelKey)}
                  </li>
                  <li aria-hidden="true">
                    <ChevronRightIcon />
                  </li>
                  <li aria-current="page">
                    {dynamicRoute?.label ?? t(current.labelKey)}
                  </li>
                </ol>
              </nav>
            ) : null}
            {!extensionSurface ? <JourneyGuide /> : null}
            <Suspense
              key={pathname}
              fallback={
                <div
                  role="status"
                  aria-label={t("common.loading")}
                  className="space-y-3"
                >
                  <Skeleton className="h-7 w-40" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-48 w-full" />
                </div>
              }
            >
              <RouteErrorBoundary>
                <Outlet />
              </RouteErrorBoundary>
            </Suspense>
          </div>
        </main>
      </div>
    </ExtensionChromeProvider>
  );
}

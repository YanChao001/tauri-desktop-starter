import { Suspense, useLayoutEffect, useRef, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { TitleBar } from "@/components/title-bar";
import { BrowserDemoBar } from "@/components/browser-demo-bar";
import { WindowBackground } from "@/components/window-background";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { APP_ROUTES, NAVIGATION_GROUPS, matchRoute } from "@/routes";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import "@/styles/app-navigation.css";

/** 感知路由的应用布局；页面失败时保留导航能力 */
export function AppShell() {
  const { pathname } = useLocation();
  const current = matchRoute(pathname);
  const group =
    NAVIGATION_GROUPS.find(({ id }) => id === current.group) ??
    NAVIGATION_GROUPS[0];
  const { t } = useI18n();
  const { settings } = useSettings();
  const routes = APP_ROUTES.filter(
    (route) => settings.appMode !== "minimal" || !route.demoOnly,
  );
  const chrome = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const header = chrome.current!;
    const root = document.documentElement;
    // 在线演示的说明栏会换行，按实际高度为固定外壳留出空间。
    const syncHeight = () =>
      root.style.setProperty(
        "--app-chrome-height",
        `${header.getBoundingClientRect().height}px`,
      );
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-chrome-height");
    };
  }, []);

  useLayoutEffect(() => {
    // 仅切换页面时重置滚动；设置搜索可能在当前路径内主动聚焦字段
    // 导航更新不应覆盖该焦点
    if (content.current) {
      content.current.scrollTop = 0;
      content.current.scrollLeft = 0;
    }
  }, [pathname]);

  return (
    <div
      className={cn(
        "app-shell text-foreground",
        !isTauri() && "app-shell-browser",
      )}
      style={
        {
          "--app-sidebar-width": `${settings.sidebarCollapsed ? 56 : settings.sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <WindowBackground />
      <div ref={chrome} className="app-chrome">
        <BrowserDemoBar />
        <TitleBar />
      </div>
      <AppSidebar routes={routes} />
      <main ref={content} className="app-main app-scroll-region" tabIndex={-1}>
        <div className="app-page-content">
          <nav
            aria-label={t("navContext.location")}
            className="app-route-context"
          >
            <ol>
              <li className="app-route-context-group">
                <span className="app-route-context-dot" aria-hidden="true" />
                {t(group.labelKey)}
              </li>
              <li aria-hidden="true">
                <ChevronRightIcon />
              </li>
              <li aria-current="page">{t(current.labelKey)}</li>
            </ol>
          </nav>
          <RouteErrorBoundary>
            <Suspense
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
              <div key={pathname} className="app-route-enter">
                <Outlet />
              </div>
            </Suspense>
          </RouteErrorBoundary>
        </div>
      </main>
    </div>
  );
}

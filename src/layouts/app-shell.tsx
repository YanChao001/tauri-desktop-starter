import { Suspense, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";
import { motion } from "motion/react";
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
import { useDemoMotion } from "@/hooks/use-demo-motion";
import { useScrollBounce } from "@/hooks/use-scroll-bounce";
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
  const main = useRef<HTMLElement>(null);
  const { reduced, visible } = useDemoMotion();
  const scrollOffset = useScrollBounce(main, !reduced && visible, pathname);

  useLayoutEffect(() => {
    // 仅切换页面时重置滚动；设置搜索可能在当前路径内主动聚焦字段
    // 导航更新不应覆盖该焦点
    if (main.current) {
      main.current.scrollTop = 0;
      main.current.scrollLeft = 0;
    }
  }, [pathname]);

  return (
    <div
      className={cn(
        "app-shell flex h-screen flex-col text-foreground",
        !isTauri() && "app-shell-browser",
      )}
    >
      <WindowBackground />
      <BrowserDemoBar />
      <TitleBar />
      <div className="app-workspace flex min-h-0 flex-1">
        <AppSidebar routes={routes} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            ref={main}
            className="app-main min-h-0 flex-1 overflow-y-auto"
            tabIndex={-1}
          >
            <div className="min-h-full overflow-clip">
              <motion.div
                className="app-page-content"
                style={{ y: scrollOffset }}
              >
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
              </motion.div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

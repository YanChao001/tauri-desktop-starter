import { Suspense, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { TitleBar } from "@/components/title-bar";
import { WindowBackground } from "@/components/window-background";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { APP_ROUTES, NAVIGATION_GROUPS, matchRoute } from "@/routes";
import "@/styles/app-navigation.css";

/** Route-aware application layout; page failures leave navigation available. */
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

  useLayoutEffect(() => {
    // Only page changes reset scrolling. Settings search may deliberately focus
    // a field on the same pathname; navigation never steals its focus.
    if (main.current) {
      main.current.scrollTop = 0;
      main.current.scrollLeft = 0;
    }
  }, [pathname]);

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden text-foreground">
      <WindowBackground />
      <TitleBar />
      <div className="app-workspace flex min-h-0 flex-1">
        <AppSidebar routes={routes} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            ref={main}
            className="app-main min-h-0 flex-1 overflow-y-auto"
            tabIndex={-1}
          >
            <div className="app-page-content">
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
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

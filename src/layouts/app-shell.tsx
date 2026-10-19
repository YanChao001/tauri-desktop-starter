import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { TitleBar } from "@/components/title-bar";
import { WindowBackground } from "@/components/window-background";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { APP_ROUTES, matchRoute } from "@/routes";
import { version } from "../../package.json";

/** Route-aware application layout; page failures leave navigation available. */
export function AppShell() {
  const { pathname } = useLocation();
  const current = matchRoute(pathname);
  const { t } = useI18n();
  const { settings } = useSettings();
  const routes = APP_ROUTES.filter(
    (route) => settings.appMode !== "minimal" || !route.demoOnly,
  );

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden text-foreground">
      <WindowBackground />
      <TitleBar />
      <div className="app-workspace flex min-h-0 flex-1">
        <AppSidebar routes={routes} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="app-page-header flex h-11 shrink-0 items-center justify-between border-b px-5">
            <h1 className="text-sm font-medium">{t(current.labelKey)}</h1>
            <span className="font-mono text-[11px] text-muted-foreground">
              v{version}
            </span>
          </header>
          <main className="app-main min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 py-6">
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
                  <Outlet />
                </Suspense>
              </RouteErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

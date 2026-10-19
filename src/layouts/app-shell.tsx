import { Suspense } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { TitleBar } from "@/components/title-bar";
import { WindowBackground } from "@/components/window-background";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { APP_ROUTES, matchRoute } from "@/routes";
import { version } from "../../package.json";

/**
 * 应用外壳：自绘标题栏 + 侧边栏 + 页面标题 + 内容区。
 *
 * 它感知路由，所以放在 `layouts/` 而不是 `components/`——
 * `components/` 里的通用组件不应知道当前在哪一页。
 */
export function AppShell() {
  const { pathname } = useLocation();
  const current = matchRoute(pathname);
  const { t } = useI18n();

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden text-foreground">
      <WindowBackground />
      <TitleBar />

      <div className="app-workspace flex min-h-0 flex-1">
        <aside className="app-sidebar flex w-56 shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground">
          <p className="px-4 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("app.tagline")}
          </p>

          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {APP_ROUTES.map(({ path, labelKey, icon: Icon, exact }) => (
              <NavLink
                key={path}
                to={path}
                end={exact}
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="space-y-1 border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
            <p>Tauri 2 · React 19</p>
            <p>{isTauri() ? t("app.native") : t("app.preview")}</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="app-page-header flex h-11 shrink-0 items-center justify-between border-b px-5">
            <h1 className="text-sm font-medium">{t(current.labelKey)}</h1>
            <span className="font-mono text-[11px] text-muted-foreground">
              v{version}
            </span>
          </header>
          <main className="app-main min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 py-6">
              <Suspense
                fallback={
                  <div className="space-y-3">
                    <Skeleton className="h-7 w-40" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-48 w-full" />
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

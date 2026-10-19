import { LayoutDashboardIcon, SettingsIcon, TerminalIcon } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ThemeToggle } from "@/components/theme-toggle";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "概览", icon: LayoutDashboardIcon, end: true },
  { to: "/bridge", label: "前端 ↔ Rust", icon: TerminalIcon, end: false },
  { to: "/settings", label: "设置", icon: SettingsIcon, end: false },
];

export function AppShell() {
  const { pathname } = useLocation();
  const current =
    NAV_ITEMS.find((item) =>
      item.end ? pathname === item.to : pathname.startsWith(item.to),
    ) ?? NAV_ITEMS[0];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
            TS
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Tauri Starter</p>
            <p className="truncate text-xs text-muted-foreground">
              桌面应用基座
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
          <p>Tauri 2 · React 19</p>
          <p>{isTauri ? "运行于原生窗口" : "浏览器预览模式"}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
          <h1 className="text-sm font-medium">{current.label}</h1>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

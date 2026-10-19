import type { ComponentType } from "react";
import {
  LayoutDashboardIcon,
  SettingsIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import Bridge from "@/pages/bridge";
import Overview from "@/pages/overview";
import Settings from "@/pages/settings";

/**
 * 路由与侧边导航的唯一数据源。
 * 加页面时只改这里，`App` 的路由表和 `AppShell` 的导航会自动跟着变。
 */
export type AppRoute = {
  /** 路由路径，首页是 "/" */
  path: string;
  /** 侧边栏与顶栏显示的名称 */
  label: string;
  icon: LucideIcon;
  component: ComponentType;
  /**
   * 作为父路由的默认页，只有首页该为 true。
   * 它和 `exact` 是两件事：前者决定路由结构，后者只影响导航高亮。
   */
  index?: boolean;
  /** 导航高亮是否精确匹配。父级路径（如 "/settings"）通常不需要 */
  exact?: boolean;
};

export const APP_ROUTES: AppRoute[] = [
  {
    path: "/",
    label: "概览",
    icon: LayoutDashboardIcon,
    component: Overview,
    index: true,
    exact: true,
  },
  {
    path: "/bridge",
    label: "前端 ↔ Rust",
    icon: TerminalIcon,
    component: Bridge,
  },
  {
    path: "/settings",
    label: "设置",
    icon: SettingsIcon,
    component: Settings,
  },
];

/** 按当前路径找对应路由，用于顶栏标题与导航高亮。 */
export function matchRoute(pathname: string): AppRoute {
  const matched = APP_ROUTES.find((route) =>
    route.exact
      ? pathname === route.path
      : pathname === route.path || pathname.startsWith(`${route.path}/`),
  );
  if (matched) return matched;

  // 未知路径回落到首页。APP_ROUTES 是编译期常量，这里只防御「被误删成空数组」
  const fallback = APP_ROUTES[0];
  if (!fallback) throw new Error("APP_ROUTES 不能为空");
  return fallback;
}

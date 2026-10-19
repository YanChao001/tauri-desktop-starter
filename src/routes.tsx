import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  BlocksIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  SparklesIcon,
  TerminalIcon,
  MonitorIcon,
  DatabaseIcon,
  ActivityIcon,
  DownloadIcon,
  type LucideIcon,
} from "lucide-react";
import type { DictKey } from "@/providers/i18n";

/**
 * 页面按路由懒加载：首屏只解析当前页，组件演示页那堆控件不会拖慢启动。
 */
const Overview = lazy(() => import("@/pages/overview"));
const Components = lazy(() => import("@/pages/components"));
const Motion = lazy(() => import("@/pages/motion"));
const Bridge = lazy(() => import("@/pages/bridge"));
const Settings = lazy(() => import("@/pages/settings"));
const Desktop = lazy(() => import("@/pages/desktop"));
const Database = lazy(() => import("@/pages/database"));
const Diagnostics = lazy(() => import("@/pages/diagnostics"));
const Updates = lazy(() => import("@/pages/updates"));

type PageComponent = ComponentType | LazyExoticComponent<ComponentType>;

/**
 * 路由与侧边导航的唯一数据源。
 * 加页面时只改这里，`App` 的路由表和 `AppShell` 的导航会自动跟着变。
 */
export type AppRoute = {
  /** 路由路径，首页是 "/" */
  path: string;
  /** 导航与页面标题的 i18n key */
  labelKey: DictKey;
  icon: LucideIcon;
  component: PageComponent;
  /**
   * 作为父路由的默认页，只有首页该为 true。
   * 它和 `exact` 是两件事：前者决定路由结构，后者只影响导航高亮。
   */
  index?: boolean;
  /** 导航高亮是否精确匹配。父级路径（如 "/settings"）通常不需要 */
  exact?: boolean;
  demoOnly?: boolean;
};

export const APP_ROUTES: AppRoute[] = [
  {
    path: "/",
    labelKey: "nav.overview",
    icon: LayoutDashboardIcon,
    component: Overview,
    index: true,
    exact: true,
  },
  {
    path: "/components",
    labelKey: "nav.components",
    icon: BlocksIcon,
    component: Components,
    demoOnly: true,
  },
  {
    path: "/motion",
    labelKey: "nav.motion",
    icon: SparklesIcon,
    component: Motion,
    demoOnly: true,
  },
  {
    path: "/bridge",
    labelKey: "nav.bridge",
    icon: TerminalIcon,
    component: Bridge,
    demoOnly: true,
  },
  {
    path: "/desktop",
    labelKey: "nav.desktop",
    icon: MonitorIcon,
    component: Desktop,
  },
  {
    path: "/database",
    labelKey: "nav.database",
    icon: DatabaseIcon,
    component: Database,
  },
  {
    path: "/diagnostics",
    labelKey: "nav.diagnostics",
    icon: ActivityIcon,
    component: Diagnostics,
  },
  {
    path: "/updates",
    labelKey: "nav.updates",
    icon: DownloadIcon,
    component: Updates,
  },
  {
    path: "/settings",
    labelKey: "nav.settings",
    icon: SettingsIcon,
    component: Settings,
  },
];

/** 按当前路径找对应路由，用于面包屑与导航高亮。 */
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

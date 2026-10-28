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
  PuzzleIcon,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey as DictKey } from "@/i18n/zh-CN";
import type { ExtensionInfo } from "@/lib/tauri";
import { canRunExtensionCommand } from "@/features/extensions/extension-model";
import { resolveExtensionIcon } from "@/features/extensions/extension-icon";
import { matchPath } from "react-router-dom";

type PageComponent = ComponentType | LazyExoticComponent<ComponentType>;

export const NAVIGATION_GROUPS = [
  { id: "experience", labelKey: "navGroup.experience" },
  { id: "capabilities", labelKey: "navGroup.capabilities" },
  { id: "extensions", labelKey: "ext.installed" },
  { id: "system", labelKey: "navGroup.system" },
] as const satisfies readonly { id: string; labelKey: DictKey }[];

export type NavigationGroup = (typeof NAVIGATION_GROUPS)[number]["id"];

/**
 * 路由与侧边导航的唯一数据源。
 * 加页面时只改这里，`App` 的路由表和 `AppShell` 的导航会自动跟着变。
 */
export type AppRoute = {
  /** 路由路径，首页是 "/" */
  path: string;
  /** 导航与页面标题的 i18n key */
  labelKey: DictKey;
  /** 展示分组只影响导航，不改变 URL 与命令注册。 */
  group: NavigationGroup;
  icon: LucideIcon;
  component: PageComponent;
  /** 导航意图只预载模块，不挂载页面或执行数据 / 原生操作。 */
  preload?: () => void;
  /**
   * 作为父路由的默认页，只有首页该为 true。
   * 它和 `exact` 是两件事：前者决定路由结构，后者只影响导航高亮。
   */
  index?: boolean;
  /** 导航高亮是否精确匹配。父级路径（如 "/settings"）通常不需要 */
  exact?: boolean;
  demoOnly?: boolean;
  hidden?: boolean;
};
export type AppNavigationItem = Pick<
  AppRoute,
  "path" | "labelKey" | "group" | "icon" | "exact" | "preload"
> & { label?: string };

export function extensionPath(id: string, command: string) {
  return `/extensions/app/${encodeURIComponent(id)}/${encodeURIComponent(command)}`;
}
function loadExtensionPage() {
  return import("@/pages/extension-app");
}
export function extensionNavigation(
  items: readonly ExtensionInfo[],
  currentPath?: string,
): AppNavigationItem[] {
  return items.flatMap((item) => {
    const manifest = item.package.manifest;
    return manifest.commands
      .filter(
        (command) =>
          canRunExtensionCommand(item, command) &&
          (command.ui?.sidebar ||
            (currentPath &&
              matchPath(
                { path: extensionPath(manifest.id, command.id), end: true },
                currentPath,
              ))) &&
          command.resultFormat === "view",
      )
      .map((command) => ({
        path: extensionPath(manifest.id, command.id),
        labelKey: "ext.title" as const,
        label:
          command.ui?.sidebar &&
          manifest.commands.filter((entry) => entry.ui?.sidebar).length === 1
            ? manifest.name
            : `${manifest.name}: ${command.title}`,
        icon: resolveExtensionIcon(manifest.icon),
        group: "extensions" as const,
        exact: true,
        preload: () => {
          void loadExtensionPage().catch(() => {});
        },
      }));
  });
}
export const WINDOW_ROUTES = [
  {
    path: "/extension-window/:extensionId/:commandId",
    ...lazyPage(() => import("@/pages/extension-window")),
  },
];

function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return {
    component: lazy(load),
    preload: () => {
      // import 自身复用模块缓存；预载失败交给实际导航时的错误边界展示。
      void load().catch(() => {});
    },
  };
}

export const APP_ROUTES: AppRoute[] = [
  {
    path: "/",
    labelKey: "nav.overview",
    group: "experience",
    icon: LayoutDashboardIcon,
    ...lazyPage(() => import("@/pages/overview")),
    index: true,
    exact: true,
  },
  {
    path: "/catalog",
    labelKey: "nav.catalog",
    group: "experience",
    icon: BlocksIcon,
    ...lazyPage(() => import("@/pages/catalog")),
  },
  {
    path: "/recovery",
    labelKey: "nav.diagnostics",
    group: "system",
    icon: ActivityIcon,
    ...lazyPage(() => import("@/pages/recovery")),
    hidden: true,
  },
  {
    path: "/workbench",
    labelKey: "nav.workbench",
    group: "capabilities",
    icon: BlocksIcon,
    ...lazyPage(() => import("@/pages/workbench")),
  },
  {
    path: "/tasks",
    labelKey: "nav.tasks",
    group: "capabilities",
    icon: ActivityIcon,
    ...lazyPage(() => import("@/pages/tasks")),
  },
  {
    path: "/system",
    labelKey: "nav.system",
    group: "capabilities",
    icon: MonitorIcon,
    ...lazyPage(() => import("@/pages/system")),
  },
  {
    path: "/extensions",
    labelKey: "nav.extensions",
    group: "capabilities",
    icon: PuzzleIcon,
    ...lazyPage(() => import("@/pages/extensions")),
    exact: true,
  },
  {
    path: "/extensions/app/:extensionId/:commandId",
    labelKey: "ext.title",
    group: "extensions",
    icon: PuzzleIcon,
    ...lazyPage(loadExtensionPage),
    hidden: true,
  },
  {
    path: "/network",
    labelKey: "nav.network",
    group: "capabilities",
    icon: TerminalIcon,
    ...lazyPage(() => import("@/pages/network")),
  },
  {
    path: "/data-studio",
    labelKey: "nav.dataStudio",
    group: "experience",
    icon: DatabaseIcon,
    ...lazyPage(() => import("@/pages/data-studio")),
    demoOnly: true,
  },
  {
    path: "/media",
    labelKey: "nav.media",
    group: "experience",
    icon: SparklesIcon,
    ...lazyPage(() => import("@/pages/media")),
    demoOnly: true,
  },
  {
    path: "/components",
    labelKey: "nav.components",
    group: "experience",
    icon: BlocksIcon,
    ...lazyPage(() => import("@/pages/components")),
    demoOnly: true,
  },
  {
    path: "/motion",
    labelKey: "nav.motion",
    group: "experience",
    icon: SparklesIcon,
    ...lazyPage(() => import("@/pages/motion")),
    demoOnly: true,
  },
  {
    path: "/desktop",
    labelKey: "nav.settings",
    group: "capabilities",
    icon: MonitorIcon,
    ...lazyPage(() => import("@/pages/desktop")),
    hidden: true,
  },
  {
    path: "/database",
    labelKey: "nav.database",
    group: "capabilities",
    icon: DatabaseIcon,
    ...lazyPage(() => import("@/pages/database")),
  },
  {
    path: "/bridge",
    labelKey: "nav.bridge",
    group: "capabilities",
    icon: TerminalIcon,
    ...lazyPage(() => import("@/pages/bridge")),
    demoOnly: true,
  },
  {
    path: "/diagnostics",
    labelKey: "nav.diagnostics",
    group: "system",
    icon: ActivityIcon,
    ...lazyPage(() => import("@/pages/diagnostics")),
  },
  {
    path: "/updates",
    labelKey: "nav.settings",
    group: "system",
    icon: DownloadIcon,
    ...lazyPage(() => import("@/pages/updates")),
    hidden: true,
  },
  {
    path: "/settings",
    labelKey: "nav.settings",
    group: "system",
    icon: SettingsIcon,
    ...lazyPage(() => import("@/pages/settings")),
  },
];

/** 按当前路径找对应路由，用于面包屑与导航高亮。 */
export function matchRoute(pathname: string): AppRoute {
  const matched = APP_ROUTES.find((route) =>
    route.path.includes(":")
      ? matchPath({ path: route.path, end: true }, pathname) !== null
      : route.exact
        ? pathname === route.path
        : pathname === route.path || pathname.startsWith(`${route.path}/`),
  );
  if (matched) return matched;

  // 未知路径回落到首页。APP_ROUTES 是编译期常量，这里只防御「被误删成空数组」
  const fallback = APP_ROUTES[0];
  if (!fallback) throw new Error("APP_ROUTES 不能为空");
  return fallback;
}

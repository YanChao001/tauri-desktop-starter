import { useLocation, useNavigate } from "react-router-dom";
import { isTauri } from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { APP_ROUTES, NAVIGATION_GROUPS, matchRoute } from "@/routes";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "@/styles/compact-navigation.css";

/** 窄屏把页面选择放在标题栏内，浏览器始终呈现完整桌面画布。 */
export function CompactNavigation() {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (isTauri()) return null;
  const routes = APP_ROUTES.filter(
    (route) =>
      !route.hidden && (settings.appMode !== "minimal" || !route.demoOnly),
  );
  const current = matchRoute(pathname);
  const currentVisible = routes.some((route) => route.path === current.path);
  return (
    <Select
      value={currentVisible ? current.path : ""}
      onValueChange={(value) => navigate(value)}
    >
      <SelectTrigger
        className="app-compact-navigation"
        aria-label={t("browserDemo.navigation")}
      >
        <SelectValue placeholder={t(current.labelKey)} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {NAVIGATION_GROUPS.map((group) => {
          const entries = routes.filter((route) => route.group === group.id);
          return entries.length ? (
            <SelectGroup key={group.id}>
              <SelectLabel>{t(group.labelKey)}</SelectLabel>
              {entries.map((route) => (
                <SelectItem key={route.path} value={route.path}>
                  {t(route.labelKey)}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null;
        })}
      </SelectContent>
    </Select>
  );
}

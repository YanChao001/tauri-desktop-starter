import { Code2Icon, DownloadIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_CONFIG } from "@/config/app";
import { isTauri } from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { APP_ROUTES, NAVIGATION_GROUPS, matchRoute } from "@/routes";
import "@/styles/browser-demo.css";

/** 浏览器直接运行应用界面；窄屏导航复用应用路由，不修改桌面布局偏好。 */
export function BrowserDemoBar() {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (isTauri()) return null;
  const routes = APP_ROUTES.filter(
    (route) => settings.appMode !== "minimal" || !route.demoOnly,
  );
  const current = matchRoute(pathname);
  const currentVisible = routes.some((route) => route.path === current.path);
  return (
    <section className="browser-demo-bar" aria-label={t("browserDemo.title")}>
      <div className="browser-demo-identity">
        <strong>{APP_CONFIG.name}</strong>
        <span className="browser-demo-badge">{t("browserDemo.title")}</span>
        <p>{t("browserDemo.description")}</p>
      </div>
      <div className="browser-demo-links">
        <a
          href={APP_CONFIG.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Code2Icon aria-hidden="true" />
          {t("browserDemo.source")}
        </a>
        <a
          href={`${APP_CONFIG.repositoryUrl.replace(/\/$/, "")}/releases`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <DownloadIcon aria-hidden="true" />
          {t("browserDemo.download")}
        </a>
      </div>
      <select
        className="browser-demo-navigation"
        aria-label={t("browserDemo.navigation")}
        value={currentVisible ? current.path : ""}
        onChange={(event) => navigate(event.target.value)}
      >
        {!currentVisible ? (
          <option value="" disabled>
            {t(current.labelKey)}
          </option>
        ) : null}
        {NAVIGATION_GROUPS.map((group) => {
          const entries = routes.filter((route) => route.group === group.id);
          return entries.length ? (
            <optgroup key={group.id} label={t(group.labelKey)}>
              {entries.map((route) => (
                <option key={route.path} value={route.path}>
                  {t(route.labelKey)}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
    </section>
  );
}

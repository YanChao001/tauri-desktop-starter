import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getActivationSnapshot,
  getCurrentWindowLabel,
  getWorkspace,
  isTauri,
  onActivation,
  onSystemNotification,
  onWorkspaceRoute,
  saveWorkspaceRoute,
  recoveryStatus,
} from "@/lib/tauri";
import { APP_ROUTES } from "@/routes";
import { reportClientError } from "@/lib/report-error";

export function useWorkspace() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const navigation = useRef({ pathname, navigate, generation: 0 });
  const pendingNavigation = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (navigation.current.pathname !== pathname) {
      navigation.current.generation += 1;
      pendingNavigation.current = null;
    }
    navigation.current.pathname = pathname;
    navigation.current.navigate = navigate;
  }, [pathname, navigate]);
  useEffect(() => {
    let stopped = false;
    // StrictMode 重建订阅时也不能把已经发生的导航当作新的恢复基线。
    const baseline = 0;
    const stops: (() => void)[] = [];
    const visit = (route: string) => {
      if (!stopped && APP_ROUTES.some((v) => v.path === route)) {
        navigation.current.generation += 1;
        pendingNavigation.current =
          route === navigation.current.pathname ? null : route;
        navigation.current.navigate(route);
      }
    };
    const attach = (promise: Promise<() => void>) =>
      promise.then((stop) => {
        if (stopped) stop();
        else stops.push(stop);
      });
    if (isTauri()) {
      const activationsReady = attach(
        onActivation((value) => {
          if (value.route) visit(value.route);
        }),
      );
      const routesReady = attach(onWorkspaceRoute(visit));
      void attach(onSystemNotification(() => visit("/tasks"))).catch(
        reportClientError,
      );
      void Promise.all([activationsReady, routesReady])
        .then(async () => {
          const [label, workspace, activations, recovery] = await Promise.all([
            getCurrentWindowLabel(),
            getWorkspace(),
            getActivationSnapshot(),
            recoveryStatus(),
          ]);
          if (stopped) return;
          if (recovery.active) {
            visit("/recovery");
            return;
          }
          const route =
            (label === "main" ? activations.at(-1)?.route : null) ??
            workspace.routes[label];
          if (route && baseline === navigation.current.generation) visit(route);
          setReady(true);
        })
        .catch((reason: unknown) => {
          reportClientError(reason);
        });
    }
    return () => {
      stopped = true;
      stops.forEach((stop) => stop());
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    if (ready && isTauri() && pendingNavigation.current === null)
      saving.current = saving.current
        .then(async () => {
          if (!stopped) await saveWorkspaceRoute(pathname);
        })
        .catch(reportClientError);
    return () => {
      stopped = true;
    };
  }, [ready, pathname]);
}

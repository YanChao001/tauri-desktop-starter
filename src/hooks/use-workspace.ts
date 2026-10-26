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
  loadWorkbenchDocument,
  type Activation,
} from "@/lib/tauri";
import { APP_ROUTES } from "@/routes";
import { reportClientError } from "@/lib/report-error";
import { workbenchEditor } from "@/components/workbench/editor-store";

export function useWorkspace() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const navigation = useRef({ pathname, navigate, generation: 0 });
  const pendingNavigation = useRef<string | null>(null);
  const queuedActivations = useRef(
    new Map<number, { value: Activation; generation: number }>(),
  );
  const latestActivation = useRef(-1);
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
    let mainReady = false;
    let contextKnown = false;
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
    const openActivation = (value: Activation) => {
      void workbenchEditor
        .openActivation(value, loadWorkbenchDocument)
        .catch(reportClientError);
    };
    const drainActivations = () => {
      if (stopped || !mainReady) return;
      const values = [...queuedActivations.current.values()].sort(
        (a, b) => a.value.id - b.value.id,
      );
      queuedActivations.current.clear();
      const newest = values.at(-1);
      const shouldNavigate =
        newest && newest.value.id > latestActivation.current;
      for (const { value } of values) {
        latestActivation.current = Math.max(latestActivation.current, value.id);
        openActivation(value);
      }
      if (
        shouldNavigate &&
        newest.value.route &&
        newest.generation === navigation.current.generation
      )
        visit(newest.value.route);
    };
    if (isTauri()) {
      const context = Promise.all([getCurrentWindowLabel(), recoveryStatus()]);
      const activationsReady = attach(
        onActivation((value) => {
          if (stopped || (contextKnown && !mainReady)) return;
          if (!queuedActivations.current.has(value.id))
            queuedActivations.current.set(value.id, {
              value,
              generation: navigation.current.generation,
            });
          if (queuedActivations.current.size > 20) {
            const oldest = Math.min(...queuedActivations.current.keys());
            queuedActivations.current.delete(oldest);
          }
          drainActivations();
        }),
      );
      void context
        .then(([label, recovery]) => {
          if (stopped) return;
          contextKnown = true;
          mainReady = label === "main" && !recovery.active;
          if (mainReady) drainActivations();
          else queuedActivations.current.clear();
        })
        .catch(reportClientError);
      const routesReady = attach(onWorkspaceRoute(visit));
      void attach(onSystemNotification(() => visit("/tasks"))).catch(
        reportClientError,
      );
      void Promise.all([activationsReady, routesReady])
        .then(async () => {
          const [[label, recovery], workspace, activations] = await Promise.all(
            [context, getWorkspace(), getActivationSnapshot()],
          );
          if (stopped) return;
          if (recovery.active) {
            visit("/recovery");
            return;
          }
          const ordered = [...activations].sort((a, b) => a.id - b.id);
          const newest = ordered.at(-1);
          const activationRoute =
            label === "main" && newest && newest.id >= latestActivation.current
              ? newest.route
              : null;
          if (label === "main")
            for (const value of ordered) {
              latestActivation.current = Math.max(
                latestActivation.current,
                value.id,
              );
              openActivation(value);
            }
          const route = activationRoute ?? workspace.routes[label];
          if (route && baseline === navigation.current.generation) visit(route);
          setReady(label === "main" || label === "secondary");
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
    if (
      ready &&
      isTauri() &&
      pendingNavigation.current === null &&
      APP_ROUTES.some((route) => !route.hidden && route.path === pathname)
    )
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

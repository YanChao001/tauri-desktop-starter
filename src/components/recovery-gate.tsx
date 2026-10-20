import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { isTauri, recoveryStatus, type RecoveryStatus } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";

/** 恢复隔离状态确认前不挂载普通业务页面，避免把临时数据当作正式数据。 */
export function RecoveryGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    void recoveryStatus()
      .then((value) => {
        if (!stopped) {
          setStatus(value);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!stopped) setError(reason);
      });
    return () => {
      stopped = true;
    };
  }, [attempt]);
  if (!isTauri()) return children;
  if (error)
    return (
      <main className="p-8">
        <p role="alert">{nativeErrorText(error, t)}</p>
        <Button onClick={() => setAttempt((v) => v + 1)}>
          {t("common.retry")}
        </Button>
      </main>
    );
  if (!status)
    return (
      <main className="p-8" role="status">
        {t("common.loading")}
      </main>
    );
  if (status.active && pathname !== "/recovery" && pathname !== "/diagnostics")
    return <Navigate to="/recovery" replace />;
  return children;
}

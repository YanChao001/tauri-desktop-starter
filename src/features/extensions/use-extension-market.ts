import { useCallback, useEffect, useRef, useState } from "react";
import {
  extensionMarketSnapshot,
  isTauri,
  type MarketSnapshot,
} from "@/lib/tauri";

/** 每页保留已验证目录；刷新失败不影响离线的已安装扩展。 */
export function useExtensionMarket() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const reload = useCallback(async (refresh = true) => {
    if (!isTauri()) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const snapshot = await extensionMarketSnapshot(refresh);
      if (alive.current && request === generation.current) {
        setData(snapshot);
        setError(null);
      }
    } catch (reason) {
      if (alive.current && request === generation.current) setError(reason);
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void reload(false);
    return () => {
      alive.current = false;
    };
  }, [reload]);
  return { data, loading, error, reload };
}

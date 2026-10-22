import { useCallback, useEffect, useRef, useState } from "react";
import {
  isTauri,
  isWindowFullscreen,
  onWindowResized,
  setWindowFullscreen,
} from "@/lib/tauri";

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const request = useRef(0);
  const sync = useCallback(async () => {
    request.current += 1;
    const ticket = request.current;
    const value = isTauri()
      ? await isWindowFullscreen()
      : !!document.fullscreenElement;
    if (mounted.current && ticket === request.current) setFullscreen(value);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => {
      void sync().catch((error: unknown) =>
        console.warn("读取全屏状态失败", error),
      );
    };
    if (isTauri()) {
      void onWindowResized(refresh)
        .then((stop) => {
          if (cancelled) stop();
          else {
            unsubscribe = stop;
            refresh();
          }
        })
        .catch((error: unknown) => console.warn("监听全屏状态失败", error));
    } else {
      document.addEventListener("fullscreenchange", refresh);
      refresh();
    }
    return () => {
      cancelled = true;
      mounted.current = false;
      request.current += 1;
      unsubscribe?.();
      document.removeEventListener("fullscreenchange", refresh);
    };
  }, [sync]);
  const change = useCallback(
    async (value?: boolean) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const current = isTauri()
          ? await isWindowFullscreen()
          : !!document.fullscreenElement;
        await setWindowFullscreen(value ?? !current);
        await sync();
      } finally {
        busy.current = false;
      }
    },
    [sync],
  );
  return { fullscreen, change };
}

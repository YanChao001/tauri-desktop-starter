import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/providers/i18n";
import { useSettings, type Motion } from "@/providers/settings";
import { THEME_REVEAL_EVENT, type ThemeReveal } from "@/hooks/use-theme-switch";
import hostFont from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import { nativeErrorText } from "@/lib/native-error";
import {
  openExtensionUi,
  closeExtensionUi,
  type ExtensionInfo,
  type ExtensionView,
} from "@/lib/tauri";
import {
  ExtensionUiBridge,
  type ExtensionUiRequest,
} from "./extension-ui-bridge";

const TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--destructive",
  "--destructive-foreground",
  "--ring",
  "--radius",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];
function readTheme(motion: Motion) {
  const styles = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = Object.fromEntries(
    TOKENS.map((name) => [name, styles.getPropertyValue(name).trim()]),
  );
  tokens["--host-font-size"] = styles.fontSize;
  tokens["--host-font-family"] = styles.fontFamily;
  return {
    mode: document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
    motion,
    font: { family: "Geist Variable", dataUrl: hostFont },
    tokens,
  };
}

export function ExtensionCustomUi({
  item,
  commandId,
  view,
  fields,
  checkpoint,
  busy,
  dirty,
  execute,
}: {
  item: ExtensionInfo;
  commandId: string;
  view: ExtensionView | null;
  fields: Record<string, string>;
  checkpoint: string | null;
  busy: boolean;
  dirty: boolean;
  execute: (request: ExtensionUiRequest) => Promise<unknown>;
}) {
  const { t, language } = useI18n();
  const { resolvedTheme } = useTheme();
  const { settings } = useSettings();
  const grantsIdentity = [...item.grantedPermissions].sort().join(",");
  const frame = useRef<HTMLIFrameElement>(null);
  const [lease, setLease] = useState<{ url: string; token: string } | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [handshakeReady, setHandshakeReady] = useState(false);
  const bridge = useRef<ExtensionUiBridge | null>(null);
  const run = useRef(execute);
  run.current = execute;
  const snapshot = useRef<unknown>(null);
  const hasView = useRef(view !== null);
  hasView.current = view !== null;
  const [palette, setPalette] = useState(0);
  useEffect(() => {
    let scheduled = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => setPalette((value) => value + 1));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "data-accent",
        "data-font",
        "data-font-size",
        "data-radius",
        "data-motion",
      ],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(scheduled);
    };
  }, []);
  const [theme, setTheme] = useState(() => readTheme(settings.motion));
  // Synchronize external root attributes once per palette change, rather than on each field edit.
  useLayoutEffect(
    () => setTheme(readTheme(settings.motion)),
    [palette, resolvedTheme, settings.motion],
  );
  const uiCheckpoint = useMemo(
    () => (checkpoint === null ? null : (JSON.parse(checkpoint) as unknown)),
    [checkpoint],
  );
  snapshot.current = {
    type: "state",
    value: {
      view,
      fields,
      checkpoint: uiCheckpoint,
      busy,
      dirty,
      locale: language === "zh" ? "zh-CN" : "en",
      grantedPermissions: item.grantedPermissions,
      theme,
    },
  };
  useEffect(() => {
    bridge.current?.send(snapshot.current);
  }, [view, fields, checkpoint, busy, dirty, language, theme, grantsIdentity]);
  useEffect(() => {
    const prepare = (event: Event) => {
      const detail = (event as CustomEvent<ThemeReveal>).detail;
      if (!detail || !frame.current || settings.motion === "reduced") return;
      const rectangle = frame.current.getBoundingClientRect();
      bridge.current?.send({
        type: "theme-transition",
        value: {
          ...detail,
          x: detail.clientX - rectangle.left,
          y: detail.clientY - rectangle.top,
        },
      });
    };
    window.addEventListener(THEME_REVEAL_EVENT, prepare);
    return () => window.removeEventListener(THEME_REVEAL_EVENT, prepare);
  }, [settings.motion]);
  useEffect(() => {
    let disposed = false,
      token: string | undefined;
    setLease(null);
    setError(null);
    setConnected(false);
    setHandshakeReady(false);
    queueMicrotask(() => {
      if (disposed) return;
      void openExtensionUi(
        item.package.manifest.id,
        commandId,
        item.package.sha256,
        item.generation,
      )
        .then((next) => {
          token = next.token;
          if (disposed) {
            void closeExtensionUi(next.token).catch(() => {});
            return;
          }
          setLease(next);
        })
        .catch((reason: unknown) => {
          if (!disposed) setError(reason);
        });
    });
    return () => {
      disposed = true;
      bridge.current?.close();
      bridge.current = null;
      if (token) void closeExtensionUi(token).catch(() => {});
    };
  }, [
    item.package.manifest.id,
    item.package.sha256,
    item.generation,
    commandId,
    attempt,
  ]);
  useLayoutEffect(() => {
    if (!lease) return;
    let disposed = false,
      accepted = false;
    const timer = window.setTimeout(() => {
      if (!accepted) setError(new Error("Extension UI did not connect"));
    }, 10000);
    const listener = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        typeof event.data !== "object" ||
        event.data === null
      )
        return;
      const data = event.data as Record<string, unknown>;
      if (
        Object.keys(data).sort().join(",") !== "type,version" ||
        (data.type !== "starter:ready" &&
          data.type !== "starter:failed" &&
          data.type !== "starter:painted") ||
        data.version !== 1
      )
        return;
      if (data.type === "starter:failed") {
        window.clearTimeout(timer);
        bridge.current?.close();
        setError(new Error("Extension UI could not initialize"));
        return;
      }
      if (data.type === "starter:painted") {
        if (accepted && hasView.current) setConnected(true);
        return;
      }
      if (accepted) return;
      accepted = true;
      setHandshakeReady(true);
      window.clearTimeout(timer);
      const channel = new MessageChannel();
      bridge.current = new ExtensionUiBridge(
        channel.port1,
        (request) => run.current(request),
        (reason) => {
          if (!disposed) setError(reason);
        },
      );
      frame.current?.contentWindow?.postMessage(
        { type: "starter:connect", version: 1 },
        "*",
        [channel.port2],
      );
      bridge.current.send(snapshot.current);
    };
    window.addEventListener("message", listener);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      bridge.current?.close();
      bridge.current = null;
    };
  }, [lease]);
  const initialViewReady = view !== null;
  useEffect(() => {
    if (!lease || !handshakeReady || !initialViewReady || connected || error)
      return;
    let timer: number | undefined;
    const visible = () => {
      const rectangle = frame.current?.getBoundingClientRect();
      return (
        document.visibilityState === "visible" &&
        rectangle &&
        rectangle.bottom > 0 &&
        rectangle.right > 0 &&
        rectangle.top < window.innerHeight &&
        rectangle.left < window.innerWidth
      );
    };
    const check = () => {
      if (!visible()) {
        window.clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        // This budget starts after Wasm supplied a view. Background/offscreen
        // frames may suspend rAF; give them a fresh budget when visible again.
        timer = window.setTimeout(() => {
          timer = undefined;
          if (visible()) {
            bridge.current?.close();
            setError(new Error("Extension UI did not finish initializing"));
          }
        }, 15000);
      }
    };
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(check)
        : undefined;
    if (frame.current) observer?.observe(frame.current);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", check);
    };
  }, [lease, handshakeReady, initialViewReady, connected, error]);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    let scheduled = 0;
    const measure = () => {
      const container = node.closest(".app-page-content");
      const padding = container
        ? parseFloat(getComputedStyle(container).paddingBottom)
        : 24;
      const height = Math.max(
        240,
        Math.floor(
          window.innerHeight -
            node.getBoundingClientRect().top -
            Math.max(24, padding),
        ),
      );
      if (node.style.height !== `${height}px`)
        node.style.height = `${height}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(scheduled);
    };
  }, [lease, connected, error, palette]);
  return (
    <div className="relative min-h-64 min-w-0 bg-background">
      {error ? (
        <div role="alert" className="space-y-3 rounded-lg border p-4">
          <p>{t("ext.uiUnavailable")}</p>
          <p className="text-sm text-muted-foreground">
            {nativeErrorText(error, t)}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {!error && !connected ? (
        <div className="pointer-events-none absolute inset-0 z-10 space-y-5 bg-background p-4">
          <p role="status" className="sr-only">
            {t("common.loading")}
          </p>
          <div aria-hidden="true" className="space-y-5">
            <Skeleton className="h-6 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-44 w-full" />
          </div>
        </div>
      ) : null}
      {lease && !error ? (
        <iframe
          key={lease.token}
          ref={frame}
          src={lease.url}
          title={item.package.manifest.name}
          sandbox="allow-scripts"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          referrerPolicy="no-referrer"
          className="block w-full border-0 bg-background"
          aria-hidden={!connected}
          tabIndex={connected ? undefined : -1}
          style={{
            opacity: connected ? 1 : 0,
            pointerEvents: connected ? undefined : "none",
            backgroundColor: theme.tokens["--background"],
          }}
        />
      ) : null}
    </div>
  );
}

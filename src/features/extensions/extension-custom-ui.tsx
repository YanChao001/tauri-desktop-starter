import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
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
  "--primary",
  "--primary-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--destructive",
  "--ring",
];

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
  const grantsIdentity = [...item.grantedPermissions].sort().join(",");
  const frame = useRef<HTMLIFrameElement>(null);
  const [lease, setLease] = useState<{ url: string; token: string } | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const bridge = useRef<ExtensionUiBridge | null>(null);
  const run = useRef(execute);
  run.current = execute;
  const snapshot = useRef<unknown>(null);
  const [palette, setPalette] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setPalette((value) => value + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);
  const environment = () => {
    const styles = getComputedStyle(document.documentElement);
    return {
      type: "state",
      value: {
        view,
        fields,
        checkpoint:
          checkpoint === null ? null : (JSON.parse(checkpoint) as unknown),
        busy,
        dirty,
        locale: language === "zh" ? "zh-CN" : "en",
        grantedPermissions: item.grantedPermissions,
        theme: {
          mode: resolvedTheme === "dark" ? "dark" : "light",
          tokens: {
            ...Object.fromEntries(
              TOKENS.map((name) => [
                name,
                styles.getPropertyValue(name).trim(),
              ]),
            ),
            "--host-font-size": styles.fontSize,
            "--host-font-family": styles.fontFamily,
          },
        },
      },
    };
  };
  snapshot.current = environment();
  useEffect(() => {
    bridge.current?.send(snapshot.current);
  }, [
    view,
    fields,
    checkpoint,
    busy,
    dirty,
    language,
    resolvedTheme,
    palette,
    item.grantedPermissions,
  ]);
  useEffect(() => {
    let disposed = false,
      token: string | undefined;
    setLease(null);
    setError(null);
    setConnected(false);
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
    grantsIdentity,
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
        !["starter:ready", "starter:failed"].includes(String(data.type)) ||
        data.version !== 1
      )
        return;
      if (data.type === "starter:failed") {
        window.clearTimeout(timer);
        bridge.current?.close();
        setError(new Error("Extension UI could not initialize"));
        return;
      }
      if (accepted) return;
      accepted = true;
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
      setConnected(true);
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
    <div className="min-w-0">
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
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
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
        />
      ) : null}
    </div>
  );
}

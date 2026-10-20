import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTauri, runDemoSidecar, websocketConnect } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { useI18n } from "@/providers/i18n";
import { validWorkerInput } from "./model";

type SocketState = "disconnected" | "connecting" | "connected";
type SocketHandle = Awaited<ReturnType<typeof websocketConnect>>;

export function WebSocketPanel() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"fixture" | "wss">("fixture");
  const [state, setState] = useState<SocketState>("disconnected");
  const [message, setMessage] = useState("Hello echo");
  const [log, setLog] = useState<
    { direction: "sent" | "received"; text: string }[]
  >([]);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const handle = useRef<SocketHandle | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const sendBusy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void handle.current?.close().catch(() => {});
      handle.current = null;
    };
  }, []);
  async function connect() {
    const current = ++generation.current;
    setError(null);
    setState("connecting");
    if (mode === "fixture") {
      setState("connected");
      return;
    }
    try {
      const connection = await websocketConnect(
        "wss://echo.websocket.events",
        (text) => {
          if (mounted.current && current === generation.current)
            setLog((items) => [
              ...items.slice(-49),
              { direction: "received", text: text.slice(0, 4000) },
            ]);
        },
        () => {
          if (mounted.current && current === generation.current) {
            handle.current = null;
            setState("disconnected");
          }
        },
      );
      if (!mounted.current || current !== generation.current) {
        await connection.close();
        return;
      }
      handle.current = connection;
      setState("connected");
    } catch (reason) {
      if (mounted.current && current === generation.current) {
        setError(reason);
        setState("disconnected");
      }
    }
  }
  async function disconnect() {
    generation.current++;
    const connection = handle.current;
    handle.current = null;
    setState("disconnected");
    try {
      await connection?.close();
    } catch (reason) {
      if (mounted.current) setError(reason);
    }
  }
  async function send() {
    if (
      state !== "connected" ||
      !message.trim() ||
      message.length > 1000 ||
      sendBusy.current
    )
      return;
    const current = generation.current;
    const text = message;
    sendBusy.current = true;
    setSending(true);
    setError(null);
    try {
      if (mode === "wss") {
        if (!handle.current) return;
        await handle.current.send(text);
      }
      if (!mounted.current || current !== generation.current) return;
      setLog((items) => [
        ...items.slice(-48),
        { direction: "sent", text },
        ...(mode === "fixture"
          ? [{ direction: "received" as const, text }]
          : []),
      ]);
      setMessage("");
    } catch (reason) {
      if (mounted.current && current === generation.current) setError(reason);
    } finally {
      sendBusy.current = false;
      if (mounted.current) setSending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labs.socket.title")}</CardTitle>
        <CardDescription>{t("labs.socket.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("labs.network.mode")}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            disabled={state !== "disconnected"}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value === "wss" ? "wss" : "fixture");
              setLog([]);
              setError(null);
            }}
          >
            <option value="fixture">{t("labs.socket.local")}</option>
            <option value="wss">{t("labs.socket.live")}</option>
          </select>
          <Button
            disabled={state !== "disconnected"}
            onClick={() => void connect()}
          >
            {t("labs.socket.connect")}
          </Button>
          <Button
            variant="outline"
            disabled={state === "disconnected"}
            onClick={() => void disconnect()}
          >
            {t("labs.socket.disconnect")}
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {t(`labs.socket.${state}`)}
          </span>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="socket-message">{t("labs.socket.message")}</Label>
            <Input
              id="socket-message"
              maxLength={1000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <Button
            disabled={state !== "connected" || sending || !message.trim()}
          >
            {t("labs.socket.send")}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {nativeErrorText(error, t)}
          </p>
        ) : null}
        <ol
          aria-label={t("labs.socket.log")}
          aria-live="polite"
          className="max-h-52 space-y-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
        >
          {log.length ? (
            log.map((entry, index) => (
              <li key={index} className="break-all">
                {t(`labs.socket.${entry.direction}`, { text: entry.text })}
              </li>
            ))
          ) : (
            <li>{t("labs.idle")}</li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}

export function SidecarPanel() {
  const { t } = useI18n();
  const native = isTauri();
  const [input, setInput] = useState("Hello from the desktop lab");
  const [pending, setPending] = useState(false);
  const [output, setOutput] = useState<Awaited<
    ReturnType<typeof runDemoSidecar>
  > | null>(null);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run() {
    if (!native || !validWorkerInput(input) || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await runDemoSidecar(input);
      if (mounted.current) setOutput(result);
    } catch (reason) {
      if (mounted.current) setError(reason);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labs.sidecar.title")}</CardTitle>
        <CardDescription>{t("labs.sidecar.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3" aria-busy={pending}>
        {!native ? (
          <p className="text-sm text-muted-foreground">
            {t("labs.desktopRequired")}
          </p>
        ) : null}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <Label htmlFor="sidecar-input">{t("labs.sidecar.input")}</Label>
          <Input
            id="sidecar-input"
            value={input}
            disabled={!native || pending}
            maxLength={1000}
            onChange={(event) => setInput(event.target.value)}
            aria-invalid={!validWorkerInput(input)}
            aria-describedby={
              !validWorkerInput(input) ? "sidecar-error" : undefined
            }
          />
          {!validWorkerInput(input) ? (
            <p id="sidecar-error" className="text-xs text-destructive">
              {t("labs.sidecar.tooLong")}
            </p>
          ) : null}
          <Button disabled={!native || pending || !validWorkerInput(input)}>
            {pending ? t("labs.loading") : t("labs.sidecar.run")}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {nativeErrorText(error, t)}
          </p>
        ) : null}
        <pre
          tabIndex={0}
          aria-label={t("labs.media.preview")}
          className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {output ? JSON.stringify(output, null, 2) : t("labs.idle")}
        </pre>
      </CardContent>
    </Card>
  );
}

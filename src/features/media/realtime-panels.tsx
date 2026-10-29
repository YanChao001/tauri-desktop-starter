import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isTauri, runDemoSidecar, websocketConnect } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import { useI18n, type DictKey } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { validWorkerInput, workerTextResult } from "./model";

type SocketState = "disconnected" | "connecting" | "connected";
type SocketHandle = Awaited<ReturnType<typeof websocketConnect>>;
const socketErrorKeys: Record<string, DictKey> = {
  WEBSOCKET_ENDPOINT: "labs.socket.error.endpoint",
  WEBSOCKET_TIMEOUT: "labs.socket.error.timeout",
  WEBSOCKET_CONNECTION: "labs.socket.error.connection",
  WEBSOCKET_SEND: "labs.socket.error.send",
};

export function WebSocketPanel() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const [mode, setMode] = useState<"fixture" | "wss">("fixture");
  const [state, setState] = useState<SocketState>("disconnected");
  const [message, setMessage] = useState("Hello echo");
  const [log, setLog] = useState<
    { direction: "sent" | "received"; text: string }[]
  >([]);
  const [sending, setSending] = useState(false);
  const handle = useRef<SocketHandle | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const sendBusy = useRef(false);
  function socketErrorText(reason: unknown, fallback: DictKey) {
    const code =
      reason && typeof reason === "object" && "code" in reason
        ? reason.code
        : undefined;
    return latest(
      typeof code === "string" ? (socketErrorKeys[code] ?? fallback) : fallback,
    );
  }
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
        toast.error(socketErrorText(reason, "labs.socket.error.connection"));
        setState("disconnected");
      }
    }
  }
  async function disconnect() {
    const current = ++generation.current;
    const connection = handle.current;
    handle.current = null;
    setState("disconnected");
    try {
      await connection?.close();
    } catch (reason) {
      if (mounted.current && current === generation.current)
        toast.error(socketErrorText(reason, "labs.socket.error.connection"));
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
      setMessage((draft) => (draft === text ? "" : draft));
    } catch (reason) {
      if (mounted.current && current === generation.current)
        toast.error(socketErrorText(reason, "labs.socket.error.send"));
    } finally {
      sendBusy.current = false;
      if (mounted.current) setSending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.socket.title")}
          <HelpTooltip label={`${t("labs.socket.title")} · ${t("title.help")}`}>
            {t("labs.socket.hint")}
          </HelpTooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={state !== "disconnected"}
            value={mode}
            onValueChange={(value) => {
              setMode(value === "wss" ? "wss" : "fixture");
              setLog([]);
            }}
          >
            <SelectTrigger aria-label={t("labs.network.mode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="fixture">{t("labs.socket.local")}</SelectItem>
              <SelectItem value="wss">{t("labs.socket.live")}</SelectItem>
            </SelectContent>
          </Select>
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
          <span
            role="status"
            className="w-28 truncate text-xs text-muted-foreground"
          >
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
        <ol
          aria-label={t("labs.socket.log")}
          aria-live="polite"
          data-surface="reading"
          className="h-52 space-y-1 overflow-auto rounded-md p-3 font-mono text-xs"
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
  const latest = useLatestTranslator();
  const native = isTauri();
  const [input, setInput] = useState("Hello from the desktop lab");
  const [pending, setPending] = useState(false);
  const [output, setOutput] = useState<Awaited<
    ReturnType<typeof runDemoSidecar>
  > | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const textResult = output ? workerTextResult(output.stdout) : null;
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
    try {
      const result = await runDemoSidecar(input);
      if (mounted.current) setOutput(result);
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.sidecar.title")}
        </CardTitle>
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
          <div className="space-y-1.5">
            <div className="flex h-6 min-w-0 items-center gap-2">
              <Label htmlFor="sidecar-input" className="shrink-0">
                {t("labs.sidecar.input")}
              </Label>
              {!validWorkerInput(input) ? (
                <div role="alert" className="min-w-0 flex-1">
                  <TooltipProvider delayDuration={650} skipDelayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          data-surface="transparent"
                          data-variant="ghost"
                          id="sidecar-error"
                          type="button"
                          className="block w-full truncate rounded-sm text-right text-xs text-destructive underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t("labs.sidecar.tooLong")}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="max-w-72 leading-relaxed"
                      >
                        {t("labs.sidecar.tooLong")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : null}
            </div>
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
          </div>
          <Button
            className="min-w-44"
            disabled={!native || pending || !validWorkerInput(input)}
          >
            {pending ? t("labs.loading") : t("labs.sidecar.run")}
          </Button>
        </form>
        <section
          aria-label={t("labs.sidecar.output")}
          data-surface="reading"
          className="space-y-3 rounded-md p-3 text-sm"
        >
          {output ? (
            <>
              <p
                role={output.exitCode === 0 ? "status" : "alert"}
                className={
                  output.exitCode === 0 ? undefined : "text-destructive"
                }
              >
                {output.exitCode === 0
                  ? t("labs.sidecar.completed")
                  : t("labs.sidecar.failed", { code: output.exitCode })}
              </p>
              {textResult ? (
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("labs.sidecar.transformed")}
                    </dt>
                    <dd
                      tabIndex={0}
                      className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {textResult.transformed}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("labs.sidecar.original")}
                    </dt>
                    <dd
                      tabIndex={0}
                      className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {textResult.original}
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <dt className="text-xs text-muted-foreground">
                      {t("labs.sidecar.characterCount")}
                    </dt>
                    <dd className="tabular-nums">
                      {textResult.characterCount}
                    </dd>
                  </div>
                </dl>
              ) : (
                <pre
                  data-surface="transparent"
                  tabIndex={0}
                  className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {output.stdout || t("labs.sidecar.emptyOutput")}
                </pre>
              )}
              {output.stderr ? (
                <div className="space-y-1 text-destructive">
                  <h4 className="font-medium">{t("labs.sidecar.errors")}</h4>
                  <pre
                    data-surface="transparent"
                    tabIndex={0}
                    className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-sm font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {output.stderr}
                  </pre>
                </div>
              ) : null}
              <details
                data-disclosure-radius="md"
                data-surface="transparent"
                className="border"
              >
                <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                  {t("labs.sidecar.details")}
                </summary>
                <CodeBlock
                  data-surface="transparent"
                  aria-label={t("labs.sidecar.details")}
                  code={JSON.stringify(output, null, 2)}
                  language="json"
                  className="m-3 max-h-56 p-0"
                />
              </details>
            </>
          ) : (
            <p className="text-muted-foreground">{t("labs.idle")}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

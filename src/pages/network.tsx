import { useEffect, useRef, useState } from "react";
import {
  isCancelledError,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { isTauri, nativeHttpRequest } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
import {
  canRetryRequest,
  NetworkLabError,
  requestEcho,
  type FixtureFault,
  type NetworkMode,
} from "@/features/network/client";
import {
  CredentialPanel,
  SessionPanel,
} from "@/features/network/session-panel";
import { HelpTooltip } from "@/components/help-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function NetworkLab() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const client = useQueryClient();
  const [mode, setMode] = useState<NetworkMode>("fixture");
  const [fault, setFault] = useState<FixtureFault>("none");
  const [timeoutMs, setTimeoutMs] = useState(2000);
  const [message, setMessage] = useState(() =>
    t("labs.network.messageDefault"),
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const attempts = useRef(0);
  const mounted = useRef(false);
  const postController = useRef<AbortController | null>(null);
  const postInFlight = useRef(false);
  const offline = simulatedOffline || (mode === "https" && !online);
  const queryKey = ["lab-echo", mode, fault, timeoutMs] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      requestEcho({
        mode,
        method: "GET",
        fault,
        timeoutMs,
        signal,
        attempt: attempts.current++,
        transport: nativeHttpRequest,
      }),
    enabled: false,
    staleTime: 30000,
    networkMode: "always",
    retry: canRetryRequest,
    retryDelay: 400,
  });
  const mutation = useMutation({
    mutationFn: () => {
      postController.current?.abort();
      postController.current = new AbortController();
      return requestEcho({
        mode,
        method: "POST",
        message,
        fault,
        timeoutMs,
        signal: postController.current.signal,
        transport: nativeHttpRequest,
      });
    },
    retry: false,
    onError: reportError,
    onSettled: () => {
      postInFlight.current = false;
      postController.current = null;
    },
  });
  useEffect(() => {
    mounted.current = true;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      postController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (offline) {
      void client.cancelQueries({ queryKey: ["lab-echo"] });
      postController.current?.abort();
    }
  }, [offline, client]);
  function errorText(reason: unknown) {
    return reason instanceof NetworkLabError
      ? latest(`labs.network.error.${reason.code}`)
      : nativeErrorText(reason, latest);
  }
  function reportError(reason: unknown) {
    if (
      mounted.current &&
      !isCancelledError(reason) &&
      !(reason instanceof NetworkLabError && reason.code === "cancelled")
    )
      toast.error(errorText(reason));
  }
  const busy = query.isFetching || mutation.isPending;
  const lastError = mutation.status === "idle" ? query.error : mutation.error;
  const statusText = offline
    ? t("labs.network.offlineState")
    : busy
      ? t("labs.loading")
      : lastError
        ? t(
            lastError instanceof NetworkLabError &&
              lastError.code === "cancelled"
              ? "labs.network.error.cancelled"
              : "labs.network.requestError",
          )
        : mutation.data || query.data
          ? t("labs.network.normal")
          : t("labs.idle");
  const validTimeout =
    Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10000;
  async function readCache() {
    if (postInFlight.current) return;
    const state = client.getQueryState(queryKey);
    const fresh = !!state?.data && Date.now() - state.dataUpdatedAt < 30000;
    mutation.reset();
    if (offline) {
      if (state?.data) toast.info(t("labs.network.cacheOffline"));
      return;
    }
    attempts.current = 0;
    try {
      await client.fetchQuery({
        queryKey,
        queryFn: ({ signal }) =>
          requestEcho({
            mode,
            method: "GET",
            fault,
            timeoutMs,
            signal,
            attempt: attempts.current++,
            transport: nativeHttpRequest,
          }),
        staleTime: 30000,
        retry: canRetryRequest,
        retryDelay: 400,
        networkMode: "always",
      });
      if (mounted.current)
        toast.info(
          latest(fresh ? "labs.network.cacheHit" : "labs.network.cacheMiss"),
        );
    } catch (reason) {
      reportError(reason);
    }
  }
  return (
    <div className="studio-page">
      <div className="studio-intro">
        <h2>{t("labs.network.title")}</h2>
        <p>{t("labs.network.description")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("labs.network.requests")}
            <HelpTooltip
              label={`${t("labs.network.mode")} · ${t("title.help")}`}
            >
              {t(
                mode === "fixture"
                  ? "labs.network.fixtureHint"
                  : "labs.network.liveHint",
              )}
            </HelpTooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="@container/requests space-y-4">
          <div className="grid gap-3 @min-[34rem]/requests:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="request-mode">{t("labs.network.mode")}</Label>
              <Select
                value={mode}
                disabled={busy}
                onValueChange={(value) => {
                  setMode(value === "https" ? "https" : "fixture");
                  mutation.reset();
                }}
              >
                <SelectTrigger id="request-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="fixture">{t("labs.fixture")}</SelectItem>
                  <SelectItem value="https" disabled={!isTauri()}>
                    {t("labs.live")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-fault">{t("labs.network.fault")}</Label>
              <Select
                value={fault}
                disabled={mode !== "fixture" || busy}
                onValueChange={(value) => {
                  setFault(value as FixtureFault);
                  mutation.reset();
                }}
              >
                <SelectTrigger id="request-fault" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="none">
                    {t("labs.network.normal")}
                  </SelectItem>
                  <SelectItem value="flaky">
                    {t("labs.network.flaky")}
                  </SelectItem>
                  <SelectItem value="server">
                    {t("labs.network.server")}
                  </SelectItem>
                  <SelectItem value="timeout">
                    {t("labs.network.timeout")}
                  </SelectItem>
                  <SelectItem value="invalid">
                    {t("labs.network.invalid")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-timeout">
                {t("labs.network.timeoutMs")}
              </Label>
              <Input
                id="request-timeout"
                type="number"
                min={100}
                max={10000}
                value={Number.isNaN(timeoutMs) ? "" : timeoutMs}
                disabled={busy}
                onChange={(event) => {
                  setTimeoutMs(event.target.valueAsNumber);
                  mutation.reset();
                }}
                aria-invalid={!validTimeout}
                aria-describedby={
                  !validTimeout ? "request-timeout-error" : undefined
                }
              />
              {!validTimeout ? (
                <p
                  id="request-timeout-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {t("labs.network.invalidTimeout")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={simulatedOffline}
                onCheckedChange={(checked) =>
                  setSimulatedOffline(checked === true)
                }
              />
              {t("labs.network.offline")}
            </label>
            <HelpTooltip
              label={`${t("labs.network.offline")} · ${t("title.help")}`}
            >
              {t("labs.network.offlineHint")}
            </HelpTooltip>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || offline || !validTimeout}
              onClick={() => {
                if (postInFlight.current) return;
                attempts.current = 0;
                mutation.reset();
                void query.refetch({ throwOnError: true }).catch(reportError);
              }}
            >
              {t("labs.network.get")}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={busy || !validTimeout || (offline && !query.data)}
                    onClick={() => void readCache()}
                  >
                    {t("labs.network.cache")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  {t("labs.network.cacheHint")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="outline"
              disabled={!busy}
              onClick={() => {
                void client.cancelQueries({ queryKey: ["lab-echo"] });
                postController.current?.abort();
                toast.info(t("labs.network.cancelled"));
              }}
            >
              {t("labs.network.cancel")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void client.resetQueries({ queryKey: ["lab-echo"] });
                mutation.reset();
              }}
            >
              {t("labs.network.clearCache")}
            </Button>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !offline &&
                !busy &&
                !postInFlight.current &&
                client.isFetching({ queryKey: ["lab-echo"] }) === 0
              ) {
                postInFlight.current = true;
                mutation.mutate();
              }
            }}
          >
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="request-message">
                {t("labs.network.message")}
              </Label>
              <Input
                id="request-message"
                maxLength={200}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={
                busy || offline || !validTimeout || message.trim().length < 3
              }
            >
              {t("labs.network.post")}
            </Button>
          </form>
          <section aria-label={t("labs.network.response")}>
            <div className="mb-2 flex h-6 min-w-0 items-center gap-3">
              <h3 className="shrink-0 text-sm font-medium">
                {t("labs.network.response")}
              </h3>
              <p role="status" className="min-w-0 flex-1 truncate text-xs">
                {statusText}
                {mutation.status === "idle" && query.failureCount > 0 ? (
                  <span className="ml-2 text-muted-foreground">
                    {t("labs.network.attempts", { count: query.failureCount })}
                  </span>
                ) : null}
              </p>
            </div>
            <CodeBlock
              code={JSON.stringify(
                mutation.data ?? query.data ?? null,
                null,
                2,
              )}
              language="json"
              className="max-h-72 rounded-md bg-muted p-3"
            />
          </section>
        </CardContent>
      </Card>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] items-start gap-3">
        <SessionPanel />
        <CredentialPanel />
      </div>
    </div>
  );
}

export default function Network() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <NetworkLab />
    </QueryClientProvider>
  );
}

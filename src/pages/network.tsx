import { useEffect, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function NetworkLab() {
  const { t } = useI18n();
  const client = useQueryClient();
  const [mode, setMode] = useState<NetworkMode>("fixture");
  const [fault, setFault] = useState<FixtureFault>("none");
  const [timeoutMs, setTimeoutMs] = useState(2000);
  const [message, setMessage] = useState(() =>
    t("labs.network.messageDefault"),
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [notice, setNotice] = useState<
    "cancelled" | "cacheHit" | "cacheMiss" | "cacheOffline" | null
  >(null);
  const attempts = useRef(0);
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
    onSettled: () => {
      postInFlight.current = false;
      postController.current = null;
    },
  });
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
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
  const error = mutation.status === "idle" ? query.error : mutation.error;
  function errorText(reason: unknown) {
    return reason instanceof NetworkLabError
      ? t(`labs.network.error.${reason.code}`)
      : nativeErrorText(reason, t);
  }
  const busy = query.isFetching || mutation.isPending;
  const validTimeout =
    Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10000;
  async function readCache() {
    if (postInFlight.current) return;
    const state = client.getQueryState(queryKey);
    const fresh = !!state?.data && Date.now() - state.dataUpdatedAt < 30000;
    mutation.reset();
    setNotice(null);
    if (offline) {
      if (state?.data) setNotice("cacheOffline");
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
      setNotice(fresh ? "cacheHit" : "cacheMiss");
    } catch {
      /* Query 状态统一显示失败，已有缓存仍可读。 */
    }
  }
  return (
    <div className="studio-page space-y-5">
      <div className="studio-intro">
        <span className="studio-eyebrow">{t("labs.eyebrow")}</span>
        <h2>{t("labs.network.title")}</h2>
        <p>{t("labs.network.description")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>GET / POST</CardTitle>
          <CardDescription>
            {t(
              mode === "fixture"
                ? "labs.network.fixtureHint"
                : "labs.network.liveHint",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="request-mode">{t("labs.network.mode")}</Label>
              <Select
                value={mode}
                disabled={busy}
                onValueChange={(value) => {
                  setMode(value === "https" ? "https" : "fixture");
                  mutation.reset();
                  setNotice(null);
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
                  setNotice(null);
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
                  setNotice(null);
                }}
                aria-invalid={!validTimeout}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={simulatedOffline}
              onCheckedChange={(checked) =>
                setSimulatedOffline(checked === true)
              }
            />
            {t("labs.network.offline")}
          </label>
          {offline ? (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {t("labs.network.offlineHint")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || offline || !validTimeout}
              onClick={() => {
                if (postInFlight.current) return;
                attempts.current = 0;
                mutation.reset();
                setNotice(null);
                void query.refetch();
              }}
            >
              {t("labs.network.get")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !validTimeout || (offline && !query.data)}
              onClick={() => void readCache()}
            >
              {t("labs.network.cache")}
            </Button>
            <Button
              variant="outline"
              disabled={!busy}
              onClick={() => {
                void client.cancelQueries({ queryKey: ["lab-echo"] });
                postController.current?.abort();
                setNotice("cancelled");
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
                setNotice(null);
              }}
            >
              {t("labs.network.clearCache")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("labs.network.cacheHint")}
          </p>
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
                setNotice(null);
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
          <p role="status" className="text-sm">
            {busy
              ? t("labs.loading")
              : notice
                ? t(`labs.network.${notice}`)
                : t("labs.idle")}
          </p>
          {mutation.status === "idle" && query.failureCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("labs.network.attempts", { count: query.failureCount })}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
            >
              {errorText(error)}
            </p>
          ) : null}
          <section aria-label={t("labs.network.response")}>
            <h3 className="mb-2 text-sm font-medium">
              {t("labs.network.response")}
            </h3>
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
      <div className="grid items-start gap-4 xl:grid-cols-2">
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

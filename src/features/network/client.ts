import { z } from "zod";

export type NetworkMode = "fixture" | "https";
export type FixtureFault = "none" | "flaky" | "server" | "timeout" | "invalid";
export type RequestInput = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};
export type HttpTransport = (
  input: RequestInput,
  signal?: AbortSignal,
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
export type EchoResponse = {
  method: "GET" | "POST";
  url: string;
  payload: unknown;
  source: NetworkMode;
};
export type LabErrorCode =
  "timeout" | "server" | "invalid" | "input" | "cancelled";
export class NetworkLabError extends Error {
  constructor(
    public readonly code: LabErrorCode,
    public readonly retryable = code === "server",
  ) {
    super(code);
    this.name = "NetworkLabError";
  }
}

const responseSchema = z.object({
  method: z.enum(["GET", "POST"]),
  url: z.string().min(1).max(2048),
  json: z.unknown().optional(),
});
const postSchema = z.object({ message: z.string().trim().min(3).max(200) });

/** 完成、取消和超时都释放计时器及监听器，fixture 不依赖外部服务。 */
export function waitForFixture(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NetworkLabError("cancelled"));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new NetworkLabError("cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function requestEcho({
  mode,
  method,
  message = "",
  fault = "none",
  attempt = 0,
  timeoutMs = 2000,
  signal,
  transport,
}: {
  mode: NetworkMode;
  method: "GET" | "POST";
  message?: string;
  fault?: FixtureFault;
  attempt?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  transport: HttpTransport;
}): Promise<EchoResponse> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000)
    throw new NetworkLabError("input");
  const payload = method === "POST" ? postSchema.safeParse({ message }) : null;
  if (payload && !payload.success) throw new NetworkLabError("input");
  const body = payload?.success ? payload.data : null;
  let value: unknown;
  if (mode === "fixture") {
    const delay = fault === "timeout" ? timeoutMs : Math.min(500, timeoutMs);
    await waitForFixture(delay, signal);
    if (fault === "timeout" || timeoutMs < 500)
      throw new NetworkLabError("timeout");
    if (fault === "server" || (fault === "flaky" && attempt === 0))
      throw new NetworkLabError("server");
    value =
      fault === "invalid"
        ? { unexpected: true }
        : {
            method,
            url: "fixture://echo/anything",
            json: body,
          };
  } else {
    const response = await transport(
      {
        url: "https://httpbin.org/anything",
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        timeoutMs,
      },
      signal,
    );
    if (response.status < 200 || response.status >= 300)
      throw new NetworkLabError(
        "server",
        response.status >= 500 || response.status === 429,
      );
    try {
      value = JSON.parse(response.body);
    } catch {
      throw new NetworkLabError("invalid");
    }
  }
  if (signal?.aborted) throw new NetworkLabError("cancelled");
  const result = responseSchema.safeParse(value);
  if (!result.success || result.data.method !== method)
    throw new NetworkLabError("invalid");
  return {
    method,
    url: result.data.url,
    payload: result.data.json ?? null,
    source: mode,
  };
}

export function canRetryRequest(count: number, error: unknown) {
  return count < 2 && error instanceof NetworkLabError && error.retryable;
}

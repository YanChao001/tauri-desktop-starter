// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canRetryRequest,
  NetworkLabError,
  requestEcho,
  type HttpTransport,
} from "./client";

afterEach(() => vi.useRealTimers());
const transport = vi.fn<HttpTransport>();

describe("network protocol lab", () => {
  it("keeps fixture GET and POST completely local and validates the echoed payload", async () => {
    vi.useFakeTimers();
    transport.mockClear();
    const result = requestEcho({
      mode: "fixture",
      method: "POST",
      message: "  local demo  ",
      transport,
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({
      method: "POST",
      url: "fixture://echo/anything",
      payload: { message: "local demo" },
      source: "fixture",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("cancels an in-flight fixture and does not later resolve it", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = requestEcho({
      mode: "fixture",
      method: "GET",
      transport,
      signal: controller.signal,
    });
    const rejected = expect(request).rejects.toMatchObject({
      code: "cancelled",
    });
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["timeout", "invalid"] as const)(
    "rejects %s fixture failures instead of returning success data",
    async (fault) => {
      vi.useFakeTimers();
      const request = requestEcho({
        mode: "fixture",
        method: "GET",
        fault,
        transport,
      });
      const rejected = expect(request).rejects.toMatchObject({ code: fault });
      await vi.runAllTimersAsync();
      await rejected;
    },
  );

  it("supports a reproducible transient failure with a bounded retry policy", async () => {
    vi.useFakeTimers();
    const first = requestEcho({
      mode: "fixture",
      method: "GET",
      fault: "flaky",
      attempt: 0,
      transport,
    });
    const rejected = expect(first).rejects.toMatchObject({ code: "server" });
    await vi.runAllTimersAsync();
    await rejected;
    const retry = requestEcho({
      mode: "fixture",
      method: "GET",
      fault: "flaky",
      attempt: 1,
      transport,
    });
    await vi.runAllTimersAsync();
    await expect(retry).resolves.toMatchObject({ method: "GET" });
    expect(canRetryRequest(0, new NetworkLabError("server"))).toBe(true);
    expect(canRetryRequest(2, new NetworkLabError("server"))).toBe(false);
    expect(canRetryRequest(0, new NetworkLabError("invalid"))).toBe(false);
    expect(canRetryRequest(0, new NetworkLabError("cancelled"))).toBe(false);
  });

  it("passes a real POST and cancellation signal through the approved transport", async () => {
    const controller = new AbortController();
    const remote = vi.fn<HttpTransport>().mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({
        method: "POST",
        url: "https://httpbin.org/anything",
        json: { message: "hello" },
      }),
    });
    await expect(
      requestEcho({
        mode: "https",
        method: "POST",
        message: "hello",
        transport: remote,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      source: "https",
      payload: { message: "hello" },
    });
    expect(remote).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://httpbin.org/anything",
        body: '{"message":"hello"}',
      }),
      controller.signal,
    );
  });

  it("rejects malformed remote data and does not retry client HTTP errors", async () => {
    const malformed = vi.fn<HttpTransport>().mockResolvedValue({
      status: 200,
      headers: {},
      body: '{"method":"POST","url":"test"}',
    });
    await expect(
      requestEcho({ mode: "https", method: "GET", transport: malformed }),
    ).rejects.toMatchObject({ code: "invalid" });
    const forbidden = vi
      .fn<HttpTransport>()
      .mockResolvedValue({ status: 403, headers: {}, body: "" });
    const failure = await requestEcho({
      mode: "https",
      method: "GET",
      transport: forbidden,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "server", retryable: false });
    expect(canRetryRequest(0, failure)).toBe(false);
  });

  it("validates request input before calling the transport", async () => {
    transport.mockClear();
    await expect(
      requestEcho({ mode: "https", method: "POST", message: "x", transport }),
    ).rejects.toMatchObject({ code: "input" });
    await expect(
      requestEcho({
        mode: "https",
        method: "GET",
        timeoutMs: Number.NaN,
        transport,
      }),
    ).rejects.toMatchObject({ code: "input" });
    expect(transport).not.toHaveBeenCalled();
  });
});

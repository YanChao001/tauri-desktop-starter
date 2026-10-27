import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { downloadMarketExtension, type MarketDownloadProgress } from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void) {}
  },
}));

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.resetAllMocks();
});

it.each(["success", "failure"])(
  "keeps progress scoped to its command and ignores late messages after %s",
  async (outcome) => {
    let finish: ((value: unknown) => void) | undefined;
    let fail: ((reason: unknown) => void) | undefined;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const changed = vi.fn();
    const request = downloadMarketExtension(
      "example.plugin",
      "a".repeat(64),
      changed,
    );
    // Attach rejection handling before the native promise is settled.
    const settled = request.then(
      () => "success",
      (error: unknown) => error,
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const args = vi.mocked(invoke).mock.calls[0]?.[1];
    expect(invoke).toHaveBeenCalledWith("download_market_extension", {
      id: "example.plugin",
      expectedPackageSha256: "a".repeat(64),
      onProgress: expect.objectContaining({ onmessage: expect.any(Function) }),
    });
    if (!args || !("onProgress" in args))
      throw new Error("Expected a command-scoped progress channel");
    const channel = args.onProgress as {
      onmessage: (progress: MarketDownloadProgress) => void;
    };
    channel.onmessage({
      phase: "downloading",
      receivedBytes: 25,
      totalBytes: 100,
    });
    channel.onmessage({ phase: "verifying" });
    expect(changed.mock.calls).toEqual([
      [{ phase: "downloading", receivedBytes: 25, totalBytes: 100 }],
      [{ phase: "verifying" }],
    ]);
    if (outcome === "success") {
      finish?.({ content: "verified-package" });
      expect(await settled).toBe("success");
    } else {
      fail?.({
        code: "MARKET_INVALID",
        message: "bad package",
        retryable: false,
      });
      expect(await settled).toMatchObject({ code: "MARKET_INVALID" });
    }
    channel.onmessage({
      phase: "downloading",
      receivedBytes: 100,
      totalBytes: 100,
    });
    expect(changed).toHaveBeenCalledTimes(2);
  },
);

it("rejects browser downloads before creating an IPC request", async () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  await expect(
    downloadMarketExtension("example.plugin", "a".repeat(64), vi.fn()),
  ).rejects.toMatchObject({ code: "PLATFORM_UNAVAILABLE" });
  expect(invoke).not.toHaveBeenCalled();
});

// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  ExtensionUiBridge,
  parseUiRequest,
  UI_CHECKPOINT_BYTES,
  UI_NOTIFICATION_BYTES,
  type ExtensionUiRequest,
} from "./extension-ui-bridge";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
});
function message(id = 1) {
  return {
    version: 1,
    id,
    method: "run",
    params: { action: "move:left", fields: { seed: "42" } },
  };
}
function connect(
  execute: (request: ExtensionUiRequest) => Promise<unknown> = vi
    .fn()
    .mockResolvedValue({ state: "next" }),
) {
  const channel = new MessageChannel(),
    failed = vi.fn();
  const received: unknown[] = [];
  channel.port2.onmessage = (event: MessageEvent<unknown>) =>
    received.push(event.data);
  channel.port2.start();
  const bridge = new ExtensionUiBridge(channel.port1, execute, failed);
  cleanup.push(() => {
    bridge.close();
    channel.port2.close();
  });
  return { channel, bridge, failed, execute, received };
}
it("routes a typed action over its own port and sends the bounded result", async () => {
  const { channel, execute, received } = connect();
  channel.port2.postMessage(message());
  await vi.waitFor(() =>
    expect(received).toContainEqual({ id: 1, result: { state: "next" } }),
  );
  expect(execute).toHaveBeenCalledExactlyOnceWith({
    method: "run",
    action: "move:left",
    fields: { seed: "42" },
  });
});
it("forwards registered service requests without accepting a native identity", async () => {
  const { channel, execute, received } = connect();
  channel.port2.postMessage({
    version: 1,
    id: 1,
    method: "service",
    params: { service: "lan", request: { operation: "status" } },
  });
  await vi.waitFor(() =>
    expect(received).toContainEqual({ id: 1, result: { state: "next" } }),
  );
  expect(execute).toHaveBeenCalledExactlyOnceWith({
    method: "service",
    service: "lan",
    request: { operation: "status" },
  });
  expect(() =>
    parseUiRequest({
      version: 1,
      id: 2,
      method: "service",
      params: { service: "shell", request: {} },
    }),
  ).toThrow();
  expect(() =>
    parseUiRequest({
      version: 1,
      id: 2,
      method: "service",
      params: { service: "lan", request: {}, generation: 1 },
    }),
  ).toThrow();
  expect(() =>
    parseUiRequest({
      version: 1,
      id: 2,
      method: "service",
      params: { service: "wallpaper", request: [] },
    }),
  ).toThrow();
  expect(() =>
    parseUiRequest({
      version: 1,
      id: 2,
      method: "service",
      params: { service: ["lan"], request: {} },
    }),
  ).toThrow();
});
it.each([
  {
    service: "resources" as const,
    request: { action: "fetch-image", url: "https://images.example.com/a.jpg" },
  },
  {
    service: "links" as const,
    request: { url: "https://source.example.com/article" },
  },
])(
  "forwards the $service service through the same authenticated port",
  async ({ service, request }) => {
    const { channel, execute, received, failed } = connect();
    channel.port2.postMessage({
      version: 1,
      id: 1,
      method: "service",
      params: { service, request },
    });
    await vi.waitFor(() =>
      expect(received).toContainEqual({ id: 1, result: { state: "next" } }),
    );
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      method: "service",
      service,
      request,
    });
    expect(failed).not.toHaveBeenCalled();
  },
);
it.each([
  { service: "http", request: { url: "https://example.com" } },
  { service: "Resources", request: {} },
  { service: "resources", request: [] },
  { service: "links", request: null },
  { service: "resources", request: {}, expectedSha256: "forged" },
  { service: "links", request: {}, generation: 99 },
  { service: "links", request: {}, url: "https://example.com" },
])(
  "rejects an invalid service envelope without granting a new transport",
  (params) => {
    expect(() =>
      parseUiRequest({ version: 1, id: 1, method: "service", params }),
    ).toThrow("Invalid extension UI request");
  },
);
it.each(["info", "success", "error"])(
  "forwards a bounded plain-text %s notification over the authenticated port",
  async (tone) => {
    const { channel, execute, received } = connect();
    channel.port2.postMessage({
      version: 1,
      id: 1,
      method: "notify",
      params: { message: "<b>搜索失败，请重试。</b>", tone },
    });
    await vi.waitFor(() =>
      expect(received).toContainEqual({ id: 1, result: { state: "next" } }),
    );
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      method: "notify",
      message: "<b>搜索失败，请重试。</b>",
      tone,
    });
  },
);
it.each([
  { message: "", tone: "info" },
  { message: " \n\t", tone: "info" },
  { message: "bad\0text", tone: "error" },
  { message: "x".repeat(UI_NOTIFICATION_BYTES + 1), tone: "success" },
  { message: "图".repeat(Math.ceil(UI_NOTIFICATION_BYTES / 3)), tone: "info" },
  { message: "message", tone: "warning" },
  { message: "message", tone: ["info"] },
  { message: 123, tone: "info" },
  { message: "message" },
  { message: "message", tone: "info", html: true },
  { message: "message", tone: "info", duration: Infinity },
])(
  "rejects invalid notification text, tones and presentation controls",
  (params) => {
    expect(() =>
      parseUiRequest({ version: 1, id: 1, method: "notify", params }),
    ).toThrow("Invalid extension UI request");
  },
);
it("accepts the exact UTF-8 notification byte limit", () => {
  const message = "图".repeat(682) + "ab";
  expect(new TextEncoder().encode(message).length).toBe(UI_NOTIFICATION_BYTES);
  expect(
    parseUiRequest({
      version: 1,
      id: 1,
      method: "notify",
      params: { message, tone: "info" },
    }).request,
  ).toEqual({ method: "notify", message, tone: "info" });
});
it("coalesces synchronous state changes to the latest snapshot and preserves control-message order", async () => {
  const { bridge, received } = connect();
  for (let revision = 0; revision < 100; revision++)
    bridge.send({ type: "state", value: { revision } });
  bridge.send({ type: "theme-transition", value: { id: 1 } });
  bridge.send({ type: "state", value: { revision: 100 } });
  await vi.waitFor(() => expect(received).toHaveLength(3));
  expect(received).toEqual([
    { type: "state", value: { revision: 99 } },
    { type: "theme-transition", value: { id: 1 } },
    { type: "state", value: { revision: 100 } },
  ]);
});
it("can return a complete native view larger than the incoming request budget", async () => {
  const result = { state: "x".repeat(3 * 1024 * 1024) };
  const { channel, received, failed } = connect(
    vi.fn().mockResolvedValue(result),
  );
  channel.port2.postMessage(message());
  await vi.waitFor(() => expect(received).toContainEqual({ id: 1, result }));
  expect(failed).not.toHaveBeenCalled();
});
it.each([
  { ...message(), method: "invoke" },
  { ...message(), expectedGeneration: 9 },
  { ...message(), params: { ...message().params, path: "C:/private" } },
  { ...message(), id: 0 },
  {
    ...message(),
    params: { action: "move", fields: { seed: "x".repeat(256 * 1024 + 1) } },
  },
  {
    version: 1,
    id: 1,
    method: "checkpoint",
    params: { value: "{}".repeat(UI_CHECKPOINT_BYTES), dirty: true },
  },
  {
    version: 1,
    id: 1,
    method: "checkpoint",
    params: { value: "broken", dirty: true },
  },
  { version: 1, id: 1, method: "artifact", params: { index: -1 } },
])(
  "rejects forged identities, methods, oversized or malformed payloads",
  (value) => {
    expect(() => parseUiRequest(value)).toThrow("Invalid extension UI request");
  },
);
it("revokes a replayed sequence and cannot deliver late results after disposal", async () => {
  let resolve!: (value: unknown) => void;
  const execute = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { channel, failed, received } = connect(execute);
  channel.port2.postMessage(message());
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  channel.port2.postMessage(message());
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  resolve("late");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(received).not.toContainEqual({ id: 1, result: "late" });
});
it.each(["run", "resources", "links"] as const)(
  "caps in-flight %s operations and rejects a flooding peer",
  async (service) => {
    const execute = vi.fn(() => new Promise(() => {}));
    const { channel, failed } = connect(execute);
    for (let id = 1; id <= 5; id++)
      channel.port2.postMessage(
        service === "run"
          ? message(id)
          : {
              version: 1,
              id,
              method: "service",
              params: {
                service,
                request:
                  service === "resources"
                    ? { action: "preview", resourceId: "resource" }
                    : { url: "https://example.com" },
              },
            },
      );
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledTimes(4);
  },
);
it("caps message frequency even when every operation completes immediately", async () => {
  const { channel, failed } = connect();
  for (let id = 1; id <= 61; id++) {
    channel.port2.postMessage({
      version: 1,
      id,
      method: "fields",
      params: { fields: { seed: "42" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
});

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
function exchange(channel: MessageChannel, value: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    channel.port2.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => resolve(event.data),
      { once: true },
    );
    channel.port2.postMessage(value);
  });
}
function busyReceipt(id: number) {
  return {
    id,
    error: {
      code: "EXTENSION_BUSY",
      message: "Extension bridge is busy",
      retryable: true,
    },
  };
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
it.each(["run", "fields"])(
  "accepts 32 fields and rejects 33 in a %s request",
  (method) => {
    const fields = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`field${index}`, ""]),
    );
    const request = {
      version: 1,
      id: 1,
      method,
      params: { ...(method === "run" ? { action: "calculate" } : {}), fields },
    };
    expect(parseUiRequest(request).request).toMatchObject({ method, fields });
    expect(() =>
      parseUiRequest({
        ...request,
        params: { ...request.params, fields: { ...fields, field32: "" } },
      }),
    ).toThrow("Invalid extension UI request");
  },
);
it("keeps the 1 MiB aggregate field budget when all 32 fields are used", () => {
  const fields = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [
      `field${index}`,
      "x".repeat((1024 * 1024) / 32),
    ]),
  );
  const request = {
    version: 1,
    id: 1,
    method: "fields",
    params: { fields },
  };
  expect(parseUiRequest(request).request).toMatchObject({ fields });
  fields.field0 += "x";
  expect(() => parseUiRequest(request)).toThrow("Invalid extension UI request");
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
  {
    service: "window" as const,
    request: { action: "get-state" },
  },
  {
    service: "window" as const,
    request: { action: "set-always-on-top", enabled: true },
  },
  {
    service: "window" as const,
    request: { action: "set-always-on-top", enabled: false },
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
  { service: "window", request: [] },
  { service: "window", request: {} },
  { service: "window", request: { action: "close" } },
  { service: "window", request: { action: "get-state", enabled: true } },
  { service: "window", request: { action: "get-state", label: "main" } },
  { service: "window", request: { action: "get-state", path: "C:/file" } },
  { service: "window", request: { action: "get-state", id: "forged" } },
  {
    service: "window",
    request: { action: "get-state", expectedGeneration: 2 },
  },
  { service: "window", request: { action: "set-always-on-top" } },
  {
    service: "window",
    request: { action: "set-always-on-top", enabled: "true" },
  },
  {
    service: "window",
    request: { action: "set-always-on-top", enabled: true, label: "main" },
  },
  { service: "window", request: { action: "get-state" }, id: "forged" },
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
it("sends unchanged views and themes once while field patches precede their receipts", async () => {
  const { bridge, received } = connect();
  const state = {
    view: { state: "x".repeat(1024 * 1024) },
    theme: { mode: "light" },
    fields: { query: "initial" },
  };
  bridge.send({ type: "state", value: state });
  await vi.waitFor(() => expect(received).toHaveLength(1));
  bridge.send({
    type: "state",
    value: { ...state, fields: { query: "first" } },
  });
  bridge.send({
    type: "state",
    value: { ...state, fields: { query: "latest" } },
  });
  bridge.send({ id: 1, result: null });
  await vi.waitFor(() => expect(received).toHaveLength(3));
  expect(received[1]).toEqual({
    type: "state",
    value: { fields: { query: "latest" } },
  });
  expect(received[2]).toEqual({ id: 1, result: null });
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
it.each(["run", "resources", "links", "window"] as const)(
  "returns recoverable busy for a fifth in-flight %s operation",
  async (service) => {
    let finish!: (result: unknown) => void;
    const operation = new Promise((resolve) => {
      finish = resolve;
    });
    const execute = vi.fn(() => operation);
    const { channel, failed, received } = connect(execute);
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
                    : service === "window"
                      ? { action: "get-state" }
                      : { url: "https://example.com" },
              },
            },
      );
    await vi.waitFor(() => expect(received).toContainEqual(busyReceipt(5)));
    expect(execute).toHaveBeenCalledTimes(4);
    expect(failed).not.toHaveBeenCalled();
    finish("done");
    await vi.waitFor(() => expect(received).toHaveLength(5));
    expect(await exchange(channel, message(6))).toEqual({
      id: 6,
      result: "done",
    });
    expect(execute).toHaveBeenCalledTimes(5);
    expect(failed).not.toHaveBeenCalled();
  },
);
it("admits a complete 24-image fetch / preview / release burst without artificial delays", async () => {
  const { channel, execute, failed } = connect();
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  try {
    let id = 0;
    for (let image = 0; image < 24; image++) {
      for (const action of ["fetch-image", "preview", "release"]) {
        id++;
        expect(
          await exchange(channel, {
            version: 1,
            id,
            method: "service",
            params: {
              service: "resources",
              request:
                action === "fetch-image"
                  ? { action, url: `https://example.com/${image}.jpg` }
                  : { action, resourceId: `image-${image}` },
            },
          }),
        ).toEqual({ id, result: { state: "next" } });
      }
    }
    expect(execute).toHaveBeenCalledTimes(72);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
it("limits sustained throughput and refills without a fixed-window reset", async () => {
  const { channel, failed, execute } = connect();
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  try {
    for (let id = 1; id <= 96; id++) {
      expect(await exchange(channel, message(id))).toEqual({
        id,
        result: { state: "next" },
      });
    }
    expect(await exchange(channel, message(97))).toEqual(busyReceipt(97));
    expect(execute).toHaveBeenCalledTimes(96);
    clock.mockReturnValue(600);
    // Half a second restores exactly 30 permits, rather than another burst.
    for (let id = 98; id <= 127; id++) {
      expect(await exchange(channel, message(id))).toEqual({
        id,
        result: { state: "next" },
      });
    }
    expect(await exchange(channel, message(128))).toEqual(busyReceipt(128));
    expect(execute).toHaveBeenCalledTimes(126);
    expect(failed).not.toHaveBeenCalled();
    clock.mockReturnValue(10600);
    for (let id = 129; id <= 224; id++) {
      await exchange(channel, message(id));
    }
    expect(await exchange(channel, message(225))).toEqual(busyReceipt(225));
    expect(execute).toHaveBeenCalledTimes(222);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
it("still revokes a peer that ignores repeated busy receipts", async () => {
  const execute = vi.fn(() => new Promise(() => {}));
  const { channel, failed, received } = connect(execute);
  for (let id = 1; id <= 21; id++) channel.port2.postMessage(message(id));
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(received).toHaveLength(17));
  expect(execute).toHaveBeenCalledTimes(4);
  expect(received).toEqual([
    ...Array.from({ length: 16 }, (_, index) => busyReceipt(index + 5)),
    { type: "closed" },
  ]);
});
it("consumes rejected request IDs so they cannot be replayed", async () => {
  const execute = vi.fn(() => new Promise(() => {}));
  const { channel, failed, received } = connect(execute);
  for (let id = 1; id <= 5; id++) channel.port2.postMessage(message(id));
  await vi.waitFor(() => expect(received).toContainEqual(busyReceipt(5)));
  channel.port2.postMessage(message(5));
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(execute).toHaveBeenCalledTimes(4);
});
it("resets overload strikes after an admitted request", async () => {
  const { channel, failed, execute } = connect();
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  try {
    for (let id = 1; id <= 96; id++) await exchange(channel, message(id));
    for (let id = 97; id <= 112; id++) {
      expect(await exchange(channel, message(id))).toEqual(busyReceipt(id));
    }
    clock.mockReturnValue(117);
    expect(await exchange(channel, message(113))).toEqual({
      id: 113,
      result: { state: "next" },
    });
    for (let id = 114; id <= 129; id++) {
      expect(await exchange(channel, message(id))).toEqual(busyReceipt(id));
    }
    expect(execute).toHaveBeenCalledTimes(97);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

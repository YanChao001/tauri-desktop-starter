// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  ExtensionUiBridge,
  parseUiRequest,
  UI_CHECKPOINT_BYTES,
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
it("caps in-flight operations and rejects a flooding peer", async () => {
  const execute = vi.fn(() => new Promise(() => {}));
  const { channel, failed } = connect(execute);
  for (let id = 1; id <= 5; id++) channel.port2.postMessage(message(id));
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(execute).toHaveBeenCalledTimes(4);
});
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

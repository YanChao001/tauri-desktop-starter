import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeHttpRequest,
  NativeBridgeError,
  onSystemNotification,
  registerGlobalShortcut,
  sendSystemNotification,
  websocketConnect,
  type HttpDemoRequest,
} from "./tauri";

// jsdom does not expose Web Streams. Load the standard Node implementation through
// the test runner without adding Node globals to the browser TypeScript project.
const { ReadableStream: NodeReadableStream } = await vi.importActual<{
  ReadableStream: typeof ReadableStream;
}>("node:stream/web");

const plugins = vi.hoisted(() => ({
  requestDemoHttp: vi.fn(),
  cancelDemoHttp: vi.fn(),
  channelCreated: vi.fn(),
  channels: [] as { onmessage: (message: null) => void }[],
  isPermissionGranted: vi.fn<() => Promise<boolean>>(),
  requestPermission: vi.fn<() => Promise<NotificationPermission>>(),
  sendNotification: vi.fn(),
  onAction: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: null) => void;
    constructor(onmessage: (message: null) => void) {
      this.onmessage = onmessage;
      plugins.channels.push(this);
      plugins.channelCreated();
    }
  },
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: plugins.isPermissionGranted,
  requestPermission: plugins.requestPermission,
  sendNotification: plugins.sendNotification,
  onAction: plugins.onAction,
}));
vi.mock("./generated/bindings", () => ({
  commands: {
    registerDemoShortcut: plugins.register,
    unregisterDemoShortcut: plugins.unregister,
    requestDemoHttp: plugins.requestDemoHttp,
    cancelDemoHttp: plugins.cancelDemoHttp,
  },
}));

const browserFetch = vi.fn<typeof fetch>();
const endpoint = "https://httpbin.org/anything";
function desktop() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
}

/** Real browser stream semantics, with spies only at the reader ownership boundary. */
function streamedResponse(chunks: Uint8Array[], error?: Error) {
  const cancel = vi.fn();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else if (error) controller.error(error);
      else controller.close();
    },
    cancel,
  });
  const response = new Response(stream, {
    status: 201,
    headers: { "X-Demo": "streamed" },
  });
  const reader = response.body!.getReader();
  const release = vi.spyOn(reader, "releaseLock");
  vi.spyOn(response.body!, "getReader").mockReturnValue(reader);
  return { response, reader, release, cancel };
}

/** The fetch boundary honors AbortSignal, without sockets or native IPC. */
function pendingFetch() {
  browserFetch.mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing cancellation signal");
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      }),
  );
}

class TestWebSocket {
  static OPEN = 1;
  static instances: TestWebSocket[] = [];
  readyState = 0;
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  send = vi.fn();
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = 2;
  });
  constructor(readonly url: string) {
    TestWebSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  message(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  closed() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", browserFetch);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  vi.stubGlobal("WebSocket", TestWebSocket);
  TestWebSocket.instances = [];
  plugins.channels = [];
  plugins.cancelDemoHttp.mockResolvedValue({ status: "ok", data: undefined });
  plugins.isPermissionGranted.mockResolvedValue(false);
  plugins.requestPermission.mockResolvedValue("denied");
  plugins.register.mockResolvedValue({ status: "ok", data: undefined });
  plugins.unregister.mockResolvedValue({ status: "ok", data: undefined });
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HTTPS bridge boundaries", () => {
  it.each([
    "http://httpbin.org/anything",
    "https://httpbin.org.evil.test/anything",
    "https://user:secret@httpbin.org/anything",
    "https://httpbin.org:8443/anything",
    "https://example.test/",
    "file:///private.txt",
  ])(
    "rejects the unapproved destination %s before either transport runs",
    async (url) => {
      desktop();
      await expect(nativeHttpRequest({ url, method: "GET" })).rejects.toThrow();
      expect(browserFetch).not.toHaveBeenCalled();
      expect(plugins.requestDemoHttp).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported methods and oversized request bodies before dispatch", async () => {
    await expect(
      nativeHttpRequest({
        url: endpoint,
        method: "DELETE",
      } as unknown as HttpDemoRequest),
    ).rejects.toThrow("Unsupported request");
    await expect(
      nativeHttpRequest({
        url: endpoint,
        method: "POST",
        body: "x".repeat(65537),
      }),
    ).rejects.toThrow("body size");
    expect(browserFetch).not.toHaveBeenCalled();
    expect(plugins.requestDemoHttp).not.toHaveBeenCalled();
  });

  it("routes a browser POST and decodes split UTF-8", async () => {
    const bytes = new TextEncoder().encode("你好");
    const { response, release } = streamedResponse([
      bytes.slice(0, 2),
      bytes.slice(2),
    ]);
    browserFetch.mockResolvedValue(response);
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    await expect(
      nativeHttpRequest(
        {
          url: endpoint,
          method: "POST",
          body: "demo",
          headers: { "Content-Type": "text/plain" },
        },
        caller.signal,
      ),
    ).resolves.toEqual({
      status: 201,
      headers: { "x-demo": "streamed" },
      body: "你好",
    });
    expect(browserFetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: "POST",
        body: "demo",
        credentials: "omit",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(plugins.requestDemoHttp).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("routes desktop HTTP through the typed host command", async () => {
    desktop();
    const result = {
      status: 201,
      headers: { "content-type": "text/plain" },
      body: "你好",
    };
    plugins.requestDemoHttp.mockImplementation(
      (_id, _input, onStarted: { onmessage: (message: null) => void }) => {
        onStarted.onmessage(null);
        return Promise.resolve({ status: "ok", data: result });
      },
    );
    await expect(
      nativeHttpRequest({
        url: endpoint,
        method: "POST",
        body: "demo",
        headers: { "Content-Type": "text/plain" },
      }),
    ).resolves.toEqual(result);
    expect(plugins.requestDemoHttp).toHaveBeenCalledWith(
      expect.any(String),
      {
        url: endpoint,
        method: "POST",
        body: "demo",
        headers: { "Content-Type": "text/plain" },
        timeoutMs: 10000,
      },
      plugins.channels[0],
    );
    expect(browserFetch).not.toHaveBeenCalled();
    expect(plugins.cancelDemoHttp).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["before-import", "during-import"] as const)(
    "does not dispatch a desktop request cancelled %s",
    async (phase) => {
      desktop();
      const caller = new AbortController();
      if (phase === "during-import")
        plugins.channelCreated.mockImplementationOnce(() => caller.abort());
      const request = nativeHttpRequest(
        { url: endpoint, method: "GET" },
        caller.signal,
      );
      if (phase === "before-import") caller.abort();
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(plugins.requestDemoHttp).not.toHaveBeenCalled();
      expect(plugins.cancelDemoHttp).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([false, true])(
    "cancels the registered desktop operation when aborted (already acknowledged: %s)",
    async (acknowledged) => {
      desktop();
      let finish: ((value: unknown) => void) | undefined;
      plugins.requestDemoHttp.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const caller = new AbortController();
      const request = nativeHttpRequest(
        { url: endpoint, method: "GET" },
        caller.signal,
      );
      const cancelled = expect(request).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.waitFor(() =>
        expect(plugins.requestDemoHttp).toHaveBeenCalledOnce(),
      );
      const channel = plugins.channels[0]!;
      if (acknowledged) channel.onmessage(null);
      caller.abort();
      if (!acknowledged) {
        expect(plugins.cancelDemoHttp).not.toHaveBeenCalled();
        channel.onmessage(null);
      }
      await vi.waitFor(() =>
        expect(plugins.cancelDemoHttp).toHaveBeenCalledOnce(),
      );
      expect(plugins.cancelDemoHttp).toHaveBeenCalledWith(
        plugins.requestDemoHttp.mock.calls[0]?.[0],
      );
      finish?.({
        status: "error",
        error: {
          code: "USER_CANCELLED",
          message: "HTTP demo request was cancelled",
          retryable: false,
        },
      });
      await cancelled;
      channel.onmessage(null);
      expect(plugins.cancelDemoHttp).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("forwards desktop timeout to native cancellation and keeps TimeoutError", async () => {
    desktop();
    let finish: ((value: unknown) => void) | undefined;
    plugins.requestDemoHttp.mockImplementation(
      (_id, _input, channel: { onmessage: (message: null) => void }) => {
        channel.onmessage(null);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    plugins.cancelDemoHttp.mockImplementation(() => {
      finish?.({
        status: "error",
        error: {
          code: "USER_CANCELLED",
          message: "HTTP demo request was cancelled",
          retryable: false,
        },
      });
      return Promise.resolve({ status: "ok", data: undefined });
    });
    const request = nativeHttpRequest({
      url: endpoint,
      method: "GET",
      timeoutMs: 100,
    });
    const timedOut = expect(request).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.waitFor(() =>
      expect(plugins.requestDemoHttp).toHaveBeenCalledOnce(),
    );
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(plugins.cancelDemoHttp).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a native timeout recognizable before the browser timer fires", async () => {
    desktop();
    plugins.requestDemoHttp.mockResolvedValue({
      status: "error",
      error: {
        code: "HTTP_TIMEOUT",
        message: "HTTP demo request timed out; retry the request",
        retryable: true,
      },
    });
    await expect(
      nativeHttpRequest({ url: endpoint, method: "GET", timeoutMs: 10000 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(plugins.cancelDemoHttp).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts the second HTTPS host and omits a GET body", async () => {
    browserFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      nativeHttpRequest({
        url: "https://jsonplaceholder.typicode.com/posts/1",
        method: "GET",
        body: "not sent",
      }),
    ).resolves.toMatchObject({ status: 204, body: "" });
    expect(browserFetch).toHaveBeenCalledWith(
      "https://jsonplaceholder.typicode.com/posts/1",
      expect.objectContaining({ body: undefined }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards caller cancellation and removes its listener and timeout", async () => {
    pendingFetch();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const request = nativeHttpRequest(
      { url: endpoint, method: "GET" },
      caller.signal,
    );
    const cancelled = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    caller.abort();
    await cancelled;
    expect(browserFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a pending fetch without leaving its timer alive", async () => {
    pendingFetch();
    const request = nativeHttpRequest({
      url: endpoint,
      method: "GET",
      timeoutMs: 100,
    });
    const timedOut = expect(request).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(browserFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "enforces the 2 MiB response boundary (over limit: %s) and releases the reader",
    async (overLimit) => {
      const chunks = [
        new Uint8Array(2 * 1024 * 1024),
        ...(overLimit ? [new Uint8Array([1])] : []),
      ];
      const { response, release } = streamedResponse(chunks);
      browserFetch.mockResolvedValue(response);
      const request = nativeHttpRequest({ url: endpoint, method: "GET" });
      if (overLimit) {
        await expect(request).rejects.toThrow("exceeds 2 MiB");
        expect(browserFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      } else expect((await request).body).toHaveLength(2 * 1024 * 1024);
      expect(release).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("releases reader ownership and listener state when a response stream fails", async () => {
    const { response, release } = streamedResponse(
      [new Uint8Array([65])],
      new Error("stream failed"),
    );
    browserFetch.mockResolvedValue(response);
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    await expect(
      nativeHttpRequest({ url: endpoint, method: "GET" }, caller.signal),
    ).rejects.toThrow("stream failed");
    expect(release).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("WebSocket bridge lifecycle", () => {
  it.each([
    "ws://echo.websocket.events",
    "wss://example.test",
    "wss://user@echo.websocket.events",
    "wss://echo.websocket.events:8443",
  ])("rejects %s without opening a connection", async (url) => {
    const connection = websocketConnect(url, vi.fn());
    await expect(connection).rejects.not.toBeInstanceOf(NativeBridgeError);
    await expect(connection).rejects.toMatchObject({
      code: "WEBSOCKET_ENDPOINT",
      retryable: false,
    });
    expect(TestWebSocket.instances).toHaveLength(0);
  });

  it("rejects a connection closed before open and clears the connect timer", async () => {
    const onClose = vi.fn();
    const connection = websocketConnect(
      "wss://echo.websocket.events",
      vi.fn(),
      onClose,
    );
    const rejected = expect(connection).rejects.toMatchObject({
      code: "WEBSOCKET_CONNECTION",
      retryable: true,
    });
    TestWebSocket.instances[0]!.closed();
    await rejected;
    expect(onClose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers text, rejects oversized sends, closes oversized inbound messages and releases the socket", async () => {
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const connection = websocketConnect(
      "wss://echo.websocket.events",
      onMessage,
      onClose,
    );
    const socket = TestWebSocket.instances[0]!;
    socket.open();
    const handle = await connection;
    expect(vi.getTimerCount()).toBe(0);
    await handle.send("hello");
    expect(socket.send).toHaveBeenCalledWith("hello");
    socket.message("echo");
    expect(onMessage).toHaveBeenCalledWith("echo");
    await expect(handle.send("x".repeat(65537))).rejects.toMatchObject({
      code: "WEBSOCKET_SEND",
      retryable: false,
    });
    expect(socket.send).toHaveBeenCalledOnce();
    socket.message("x".repeat(65537));
    expect(socket.close).toHaveBeenCalledWith(1009, "Demo message limit");
    expect(onMessage).toHaveBeenCalledOnce();
    socket.closed();
    expect(onClose).toHaveBeenCalledOnce();
    await expect(handle.send("closed")).rejects.toMatchObject({
      code: "WEBSOCKET_SEND",
    });
    await handle.close();
    expect(socket.close).toHaveBeenLastCalledWith(1000);
  });

  it("closes a timed-out connection and leaves no pending timer", async () => {
    const connection = websocketConnect("wss://echo.websocket.events", vi.fn());
    const rejected = expect(connection).rejects.toMatchObject({
      code: "WEBSOCKET_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(TestWebSocket.instances[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("notification permission and subscriptions", () => {
  it("does not request permission or send when a background call lacks authorization", async () => {
    desktop();
    await expect(sendSystemNotification("Demo", "Body", false)).resolves.toBe(
      false,
    );
    expect(plugins.requestPermission).not.toHaveBeenCalled();
    expect(plugins.sendNotification).not.toHaveBeenCalled();
  });

  it.each(["denied", "granted"] as const)(
    "explicitly requests permission and honors %s",
    async (permission) => {
      desktop();
      plugins.requestPermission.mockResolvedValue(permission);
      await expect(sendSystemNotification("Demo", "Body", true)).resolves.toBe(
        permission === "granted",
      );
      expect(plugins.requestPermission).toHaveBeenCalledOnce();
      if (permission === "granted")
        expect(plugins.sendNotification).toHaveBeenCalledWith({
          title: "Demo",
          body: "Body",
        });
      else expect(plugins.sendNotification).not.toHaveBeenCalled();
    },
  );

  it("uses an existing grant without another prompt and returns subscription cleanup", async () => {
    desktop();
    plugins.isPermissionGranted.mockResolvedValue(true);
    await expect(sendSystemNotification("Demo", "Body", false)).resolves.toBe(
      true,
    );
    expect(plugins.requestPermission).not.toHaveBeenCalled();
    expect(plugins.sendNotification).toHaveBeenCalledOnce();
    const unregister = vi.fn().mockResolvedValue(undefined);
    plugins.onAction.mockResolvedValue({ unregister });
    const handler = vi.fn();
    const dispose = await onSystemNotification(handler);
    expect(plugins.onAction).toHaveBeenCalledWith(handler);
    dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });

  it("rejects browser notifications before touching a native plugin", async () => {
    await expect(sendSystemNotification("Demo", "Body")).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    expect(plugins.isPermissionGranted).not.toHaveBeenCalled();
    expect(plugins.requestPermission).not.toHaveBeenCalled();
  });
});

describe("global shortcut ownership", () => {
  it.each([
    "CommandOrControl+Shift+Space",
    "CommandOrControl+Shift+Y",
    "Alt+Shift+Y",
  ])(
    "registers only the approved %s and returns its own cancellation",
    async (shortcut) => {
      desktop();
      const cancel = await registerGlobalShortcut(shortcut);
      expect(plugins.register).toHaveBeenCalledExactlyOnceWith(shortcut);
      await cancel();
      expect(plugins.unregister).toHaveBeenCalledWith(shortcut);
    },
  );

  it("preserves native allowlist and shortcut conflict errors without unregistering", async () => {
    desktop();
    plugins.register.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "INVALID_ARGUMENT",
        message: "Unsupported demo shortcut",
        retryable: false,
      },
    });
    await expect(registerGlobalShortcut("CommandOrControl+Q")).rejects.toThrow(
      "Unsupported demo shortcut",
    );
    plugins.register.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "CONFLICT",
        message: "Shortcut is already registered",
        retryable: false,
      },
    });
    await expect(registerGlobalShortcut("Alt+Shift+Y")).rejects.toThrow(
      "already registered",
    );
    expect(plugins.unregister).not.toHaveBeenCalled();
  });

  it("keeps registration and unregistration failures observable", async () => {
    desktop();
    plugins.register.mockRejectedValueOnce(new Error("OS shortcut occupied"));
    await expect(registerGlobalShortcut("Alt+Shift+Y")).rejects.toThrow(
      "OS shortcut occupied",
    );
    expect(plugins.unregister).not.toHaveBeenCalled();
    const unregister = await registerGlobalShortcut("Alt+Shift+Y");
    plugins.unregister.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "WINDOW_ERROR",
        message: "Cannot unregister shortcut",
        retryable: false,
      },
    });
    await expect(unregister()).rejects.toMatchObject({ code: "WINDOW_ERROR" });
  });
});

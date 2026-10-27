import { NativeBridgeError } from "@/lib/tauri";

export type ExtensionUiRequest =
  | { method: "run"; action: string; fields: Record<string, string> }
  | { method: "fields"; fields: Record<string, string> }
  | { method: "checkpoint"; value: string; dirty: boolean }
  | { method: "artifact"; index: number }
  | {
      method: "notify";
      message: string;
      tone: "info" | "success" | "error";
    }
  | {
      method: "service";
      service: "lan" | "wallpaper" | "resources" | "links" | "window";
      request: Record<string, unknown>;
    };
export const UI_CHECKPOINT_BYTES = 256 * 1024;
export const UI_NOTIFICATION_BYTES = 2048;
export const EXTENSION_MAX_FIELDS = 32;
const MESSAGE_BYTES = 2 * 1024 * 1024;
const STATE_BYTES = 12 * 1024 * 1024;
const REQUESTS_PER_SECOND = 60;
// A 24-image page uses fetch / preview / release, including fast cache hits.
const REQUEST_BURST = 96;
const OVERLOAD_TOLERANCE = 16;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string) {
  return Object.keys(value).sort().join(",") === expected;
}
function invalid(): never {
  throw new NativeBridgeError({
    code: "INVALID_ARGUMENT",
    message: "Invalid extension UI request",
    retryable: false,
  });
}
function fields(value: unknown): Record<string, string> {
  if (!record(value) || Object.keys(value).length > EXTENSION_MAX_FIELDS)
    invalid();
  let bytes = 0;
  for (const [key, text] of Object.entries(value)) {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(key) ||
      typeof text !== "string" ||
      text.includes("\0")
    )
      invalid();
    const size = new TextEncoder().encode(text).length;
    bytes += size;
    if (size > 256 * 1024 || bytes > 1024 * 1024) invalid();
  }
  return value as Record<string, string>;
}
export function validateUiCheckpoint(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > UI_CHECKPOINT_BYTES
  )
    return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
export function parseUiRequest(message: unknown): {
  id: number;
  request: ExtensionUiRequest;
} {
  if (
    !record(message) ||
    !keys(message, "id,method,params,version") ||
    message.version !== 1 ||
    !Number.isSafeInteger(message.id) ||
    typeof message.id !== "number" ||
    message.id < 1 ||
    message.id > 2147483647 ||
    !record(message.params)
  )
    invalid();
  const params = message.params;
  let request: ExtensionUiRequest;
  switch (message.method) {
    case "run":
      if (
        !keys(params, "action,fields") ||
        typeof params.action !== "string" ||
        !/^[a-zA-Z0-9_:-]{1,80}$/.test(params.action)
      )
        invalid();
      request = {
        method: "run",
        action: params.action,
        fields: fields(params.fields),
      };
      break;
    case "fields":
      if (!keys(params, "fields")) invalid();
      request = { method: "fields", fields: fields(params.fields) };
      break;
    case "checkpoint":
      if (
        !keys(params, "dirty,value") ||
        !validateUiCheckpoint(params.value) ||
        typeof params.dirty !== "boolean"
      )
        invalid();
      request = {
        method: "checkpoint",
        value: params.value,
        dirty: params.dirty,
      };
      break;
    case "artifact":
      if (
        !keys(params, "index") ||
        typeof params.index !== "number" ||
        !Number.isInteger(params.index) ||
        params.index < 0 ||
        params.index > 31
      )
        invalid();
      request = { method: "artifact", index: params.index };
      break;
    case "notify":
      if (
        !keys(params, "message,tone") ||
        typeof params.message !== "string" ||
        !params.message.trim() ||
        params.message.includes("\0") ||
        new TextEncoder().encode(params.message).length >
          UI_NOTIFICATION_BYTES ||
        (params.tone !== "info" &&
          params.tone !== "success" &&
          params.tone !== "error")
      )
        invalid();
      request = {
        method: "notify",
        message: params.message,
        tone: params.tone,
      };
      break;
    case "service":
      if (
        !keys(params, "request,service") ||
        (params.service !== "lan" &&
          params.service !== "wallpaper" &&
          params.service !== "resources" &&
          params.service !== "links" &&
          params.service !== "window") ||
        !record(params.request)
      )
        invalid();
      if (
        params.service === "window" &&
        !(
          (params.request.action === "get-state" &&
            keys(params.request, "action")) ||
          (params.request.action === "set-always-on-top" &&
            typeof params.request.enabled === "boolean" &&
            keys(params.request, "action,enabled"))
        )
      )
        invalid();
      request = {
        method: "service",
        service: params.service,
        request: params.request,
      };
      break;
    default:
      invalid();
  }
  return { id: message.id, request };
}

/** Only an already-authenticated frame receives this port. No message supplies native identity. */
export class ExtensionUiBridge {
  private closed = false;
  private lastId = 0;
  private inFlight = 0;
  private rateTick: number | undefined;
  private requestTokens = REQUEST_BURST;
  private consecutiveOverloads = 0;
  private pendingState: unknown = undefined;
  private lastState: Record<string, unknown> | undefined;
  private stateScheduled = false;
  constructor(
    private port: MessagePort,
    private execute: (request: ExtensionUiRequest) => Promise<unknown>,
    private failed: (error: unknown) => void,
  ) {
    port.onmessage = (event) => {
      void this.receive(event.data as unknown);
    };
    port.onmessageerror = () => this.fail();
    port.start();
  }
  private async receive(value: unknown) {
    if (this.closed) return;
    let id: number, request: ExtensionUiRequest;
    try {
      const serialized = JSON.stringify(value);
      if (
        !serialized ||
        new TextEncoder().encode(serialized).length > MESSAGE_BYTES
      )
        invalid();
      ({ id, request } = parseUiRequest(value));
      if (id <= this.lastId) invalid();
      this.lastId = id;
    } catch {
      this.fail();
      return;
    }
    const now = performance.now();
    this.requestTokens = Math.min(
      REQUEST_BURST,
      this.requestTokens +
        (Math.max(0, now - (this.rateTick ?? now)) * REQUESTS_PER_SECOND) /
          1000,
    );
    this.rateTick = now;
    const hasToken = this.requestTokens >= 1;
    if (hasToken) this.requestTokens--;
    if (!hasToken || this.inFlight >= 4) {
      // A peer may back off after a busy receipt; an unbounded flood is revoked.
      if (++this.consecutiveOverloads > OVERLOAD_TOLERANCE) {
        this.fail();
        return;
      }
      this.send({
        id,
        error: {
          code: "EXTENSION_BUSY",
          message: "Extension bridge is busy",
          retryable: true,
        },
      });
      return;
    }
    this.consecutiveOverloads = 0;
    this.inFlight++;
    try {
      const result = await this.execute(request);
      this.send({ id, result });
    } catch (error) {
      this.send({
        id,
        error: {
          code: error instanceof NativeBridgeError ? error.code : "INTERNAL",
          message: "Extension operation failed",
          retryable:
            error instanceof NativeBridgeError ? error.retryable : false,
        },
      });
    } finally {
      this.inFlight--;
    }
  }
  send(value: unknown) {
    if (this.closed) return;
    if (record(value) && value.type === "state") {
      this.pendingState = value;
      if (!this.stateScheduled) {
        this.stateScheduled = true;
        queueMicrotask(() => this.flushState());
      }
      return;
    }
    // Control messages and operation receipts are ordering barriers.
    this.flushState();
    this.post(value);
  }
  private flushState() {
    this.stateScheduled = false;
    const state = this.pendingState;
    this.pendingState = undefined;
    if (record(state) && record(state.value)) {
      // 按已发送快照比较，避免字段编辑反复编码和复制未变化的大视图与主题。
      const previous = this.lastState;
      const value = Object.fromEntries(
        Object.entries(state.value).filter(
          ([key, value]) => !previous || !Object.is(previous[key], value),
        ),
      );
      this.lastState = state.value;
      if (Object.keys(value).length) this.post({ ...state, value });
    } else if (state !== undefined) this.post(state);
  }
  private post(value: unknown) {
    if (this.closed) return;
    try {
      const text = JSON.stringify(value);
      if (!text || new TextEncoder().encode(text).length > STATE_BYTES)
        invalid();
      this.port.postMessage(value);
    } catch {
      this.fail();
    }
  }
  close() {
    if (this.closed) return;
    this.port.postMessage({ type: "closed" });
    this.closed = true;
    this.pendingState = undefined;
    this.lastState = undefined;
    this.port.onmessage = null;
    this.port.onmessageerror = null;
    this.port.close();
  }
  private fail() {
    this.close();
    this.failed(
      new NativeBridgeError({
        code: "INVALID_ARGUMENT",
        message: "Extension UI bridge limit or protocol violation",
        retryable: false,
      }),
    );
  }
}

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { UpdateProgress, UpdateStatus } from "./tauri";
import { createUpdatesStore } from "./updates-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const status = (operationId = 1, available = true): UpdateStatus => ({
  operationId,
  configured: true,
  available,
  currentVersion: "1.0.0",
  version: available ? "2.0.0" : null,
  body: null,
  date: null,
});
const progress = (
  operationId: number,
  stage: UpdateProgress["stage"],
  patch: Partial<UpdateProgress> = {},
): UpdateProgress => ({
  operationId,
  stage,
  downloaded: null,
  total: null,
  status: null,
  error: null,
  ...patch,
});
function setup() {
  let listener: ((value: UpdateProgress) => void) | undefined;
  const stop = vi.fn();
  const backend = {
    check: vi.fn(async () => status()),
    install: vi.fn(async () => {}),
    snapshot: vi.fn(async (): Promise<UpdateProgress | null> => null),
    listen: vi.fn(async (handler: (value: UpdateProgress) => void) => {
      listener = handler;
      return stop;
    }),
  };
  const store = createUpdatesStore(backend);
  return {
    store,
    backend,
    stop,
    send: (value: UpdateProgress) => listener?.(value),
  };
}

describe("multi-window updater state", () => {
  it("restores the available update in all windows after a cancelled install event", async () => {
    const env = setup();
    await env.store.attachUpdateEvents();
    await env.store.checkUpdates();
    env.send(progress(2, "downloading", { status: status(2) }));
    env.send(progress(2, "cancelled", { status: status(2) }));
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "ready",
      operationId: 2,
      error: null,
      status: { available: true },
    });
    env.send(progress(2, "downloading"));
    expect(env.store.getSnapshot().phase).toBe("ready");
  });
  it("returns to the available update after the user cancels unsaved-work authorization", async () => {
    const env = setup();
    await env.store.checkUpdates();
    env.backend.install.mockRejectedValueOnce({ code: "USER_CANCELLED" });
    await env.store.installUpdate();
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "ready",
      error: null,
      status: { available: true },
    });
    await env.store.installUpdate();
    expect(env.backend.install).toHaveBeenCalledTimes(2);
  });
  it("hydrates release metadata during an active download and clears the prior operation's release", async () => {
    const env = setup();
    env.backend.snapshot.mockResolvedValueOnce(
      progress(2, "downloading", {
        status: status(2),
        downloaded: 20,
        total: 100,
      }),
    );
    await env.store.attachUpdateEvents();
    await Promise.resolve();
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "downloading",
      status: { operationId: 2, version: "2.0.0" },
    });
    env.send(progress(3, "downloading"));
    expect(env.store.getSnapshot()).toMatchObject({
      operationId: 3,
      status: null,
    });
  });
  it("ignores a delayed local install response once a newer operation owns the state", async () => {
    const env = setup();
    await env.store.attachUpdateEvents();
    await env.store.checkUpdates();
    const install = deferred<void>();
    env.backend.install.mockReturnValueOnce(install.promise);
    const pending = env.store.installUpdate();
    env.send(progress(2, "checked", { status: status(2, false) }));
    install.resolve();
    await pending;
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "ready",
      operationId: 2,
      status: { available: false },
    });
  });
  it("deduplicates checks and replaces stale availability after a failed recheck", async () => {
    const env = setup();
    await env.store.checkUpdates();
    const check = deferred<UpdateStatus>();
    env.backend.check.mockReturnValueOnce(check.promise);
    const pending = env.store.checkUpdates();
    await env.store.checkUpdates();
    expect(env.backend.check).toHaveBeenCalledTimes(2);
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "checking",
      status: null,
    });
    check.reject(new Error("offline"));
    await pending;
    await env.store.installUpdate();
    expect(env.store.getSnapshot().phase).toBe("error");
    expect(env.backend.install).not.toHaveBeenCalled();
  });

  it("requires a fresh check after an installation failure consumes the native update", async () => {
    const env = setup();
    await env.store.checkUpdates();
    env.backend.install.mockRejectedValueOnce(new Error("download failed"));
    await env.store.installUpdate();
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "error",
      status: null,
    });
    await env.store.installUpdate();
    expect(env.backend.install).toHaveBeenCalledOnce();
    env.backend.check.mockResolvedValueOnce(status(2));
    await env.store.checkUpdates();
    const install = deferred<void>();
    env.backend.install.mockReturnValueOnce(install.promise);
    const first = env.store.installUpdate();
    await env.store.installUpdate();
    expect(env.backend.install).toHaveBeenCalledTimes(2);
    install.resolve();
    await first;
    expect(env.store.getSnapshot().phase).toBe("installed");
  });

  it("keeps download bytes and stages monotonic and makes installation terminal", async () => {
    const env = setup();
    await env.store.attachUpdateEvents();
    env.send(progress(2, "downloading", { downloaded: 80, total: 100 }));
    env.send(progress(2, "downloading", { downloaded: 20 }));
    expect(env.store.getSnapshot().progress).toMatchObject({
      downloaded: 80,
      total: 100,
    });
    env.send(progress(2, "installing"));
    env.send(progress(2, "downloading", { downloaded: 100, total: 100 }));
    expect(env.store.getSnapshot().phase).toBe("installing");
    env.send(progress(2, "installed"));
    env.send(progress(1, "failed"));
    env.send(progress(3, "checking"));
    await env.store.checkUpdates();
    expect(env.store.getSnapshot().phase).toBe("installed");
    expect(env.backend.check).not.toHaveBeenCalled();
  });

  it("recovers other windows from failed operations and ignores late packets from prior attempts", async () => {
    const env = setup();
    await env.store.attachUpdateEvents();
    env.send(progress(5, "installing"));
    const error = {
      code: "UPDATE_INSTALL_FAILED" as const,
      message: "failed",
      retryable: true,
    };
    env.send(progress(5, "failed", { error }));
    env.send(progress(5, "downloading", { downloaded: 10 }));
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "error",
      status: null,
      error,
    });
    env.send(progress(6, "checking"));
    env.send(progress(6, "checked", { status: status(6) }));
    env.send(progress(5, "failed", { error }));
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "ready",
      status: { operationId: 6, available: true },
      error: null,
    });
  });

  it("does not overwrite a newer remote operation with a delayed local check response", async () => {
    const env = setup();
    await env.store.attachUpdateEvents();
    const check = deferred<UpdateStatus>();
    env.backend.check.mockReturnValueOnce(check.promise);
    const pending = env.store.checkUpdates();
    env.send(progress(1, "checked", { status: status(1) }));
    env.send(progress(2, "downloading", { downloaded: 10 }));
    check.resolve(status(1));
    await pending;
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "downloading",
      operationId: 2,
    });
  });

  it("subscribes before hydration and ignores stale hydration snapshots", async () => {
    const env = setup();
    const hydration = deferred<UpdateProgress | null>();
    env.backend.snapshot.mockReturnValueOnce(hydration.promise);
    await env.store.attachUpdateEvents();
    env.send(progress(3, "installing"));
    hydration.resolve(progress(2, "checking"));
    await Promise.resolve();
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "installing",
      operationId: 3,
    });
    expect(env.backend.listen.mock.invocationCallOrder[0]).toBeLessThan(
      env.backend.snapshot.mock.invocationCallOrder[0]!,
    );
  });

  it("drops nonfinite progress and prevents callbacks after listener cleanup", async () => {
    const env = setup();
    const stop = await env.store.attachUpdateEvents();
    env.send(progress(-1, "installed"));
    expect(env.store.getSnapshot().phase).toBe("idle");
    env.send(progress(1, "downloading", { downloaded: NaN, total: Infinity }));
    expect(env.store.getSnapshot().progress).toMatchObject({
      downloaded: null,
      total: null,
    });
    stop();
    stop();
    const previous = env.store.getSnapshot();
    env.send(progress(2, "installed"));
    expect(env.store.getSnapshot()).toBe(previous);
    expect(env.stop).toHaveBeenCalledOnce();
  });

  it("does not turn another window's active operation into an error when a local request is rejected", async () => {
    const env = setup();
    await env.store.attachUpdateEvents();
    const check = deferred<UpdateStatus>();
    env.backend.check.mockReturnValueOnce(check.promise);
    const pending = env.store.checkUpdates();
    env.send(progress(2, "installing"));
    check.reject({ code: "UPDATE_BUSY" });
    await pending;
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "installing",
      error: null,
    });
    env.send(
      progress(2, "failed", {
        error: {
          code: "UPDATE_INSTALL_FAILED",
          message: "failed",
          retryable: true,
        },
      }),
    );
    env.backend.check.mockResolvedValueOnce(status(3, false));
    await env.store.checkUpdates();
    expect(env.store.getSnapshot()).toMatchObject({
      phase: "ready",
      status: { available: false },
    });
  });
});

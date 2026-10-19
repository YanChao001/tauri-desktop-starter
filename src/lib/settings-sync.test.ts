import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  settingsDocument,
  type AppSettings,
} from "./settings-model";
import {
  SettingsSync,
  type PersistenceStatus,
  type SettingsBackend,
  type SettingsSnapshot,
} from "./settings-sync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function snapshot(
  revision: number,
  patch: Partial<AppSettings> = {},
): SettingsSnapshot {
  return {
    revision,
    settings: settingsDocument({ ...DEFAULT_SETTINGS, ...patch }),
  };
}
function setup(initial = DEFAULT_SETTINGS, remote = snapshot(1)) {
  const states: Array<{
    settings: AppSettings;
    status: PersistenceStatus;
    error: string | null;
  }> = [];
  let listener: ((state: SettingsSnapshot) => void) | undefined;
  const stop = vi.fn();
  const backend = {
    load: vi.fn<SettingsBackend["load"]>(async () => remote),
    save: vi.fn<SettingsBackend["save"]>(async (settings, revision) => {
      if (revision !== remote.revision) throw { code: "SETTINGS_CONFLICT" };
      remote = { revision: revision + 1, settings };
      listener?.(remote);
      return remote;
    }),
    subscribe: vi.fn<SettingsBackend["subscribe"]>(async (handler) => {
      listener = handler;
      return stop;
    }),
  };
  const sync = new SettingsSync(initial, backend, (state) =>
    states.push(state),
  );
  return {
    sync,
    backend,
    stop,
    states,
    latest: () => states.at(-1)!,
    send: (value: SettingsSnapshot) => {
      remote = value;
      listener?.(value);
    },
  };
}

describe("settings synchronization", () => {
  it("subscribes before loading and seeds an empty native store from browser preferences", async () => {
    const initial = {
      ...DEFAULT_SETTINGS,
      language: "en" as const,
      accent: "rose" as const,
    };
    const env = setup(initial, { revision: 0, settings: {} });
    await env.sync.start();
    expect(env.backend.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      env.backend.load.mock.invocationCallOrder[0]!,
    );
    expect(env.backend.save).toHaveBeenCalledExactlyOnceWith(
      settingsDocument(initial),
      0,
    );
    expect(env.latest()).toEqual({
      settings: initial,
      status: "saved",
      error: null,
    });
    env.sync.stop();
  });

  it("ignores a load older than an event received during initialization, including duplicate revisions", async () => {
    const env = setup();
    env.backend.subscribe.mockImplementationOnce(async (handler) => {
      handler(snapshot(3, { theme: "dark" }));
      handler(snapshot(3, { theme: "light" }));
      return env.stop;
    });
    await env.sync.start();
    expect(env.latest().settings.theme).toBe("dark");
    expect(env.backend.save).not.toHaveBeenCalled();
    env.sync.stop();
  });

  it("keeps the first native initialization from another window instead of seeding over it", async () => {
    const env = setup(
      { ...DEFAULT_SETTINGS, accent: "rose" },
      { revision: 0, settings: {} },
    );
    env.backend.save.mockImplementationOnce(async () => {
      env.send(snapshot(1, { language: "en", theme: "dark" }));
      throw { code: "SETTINGS_CONFLICT" };
    });
    await env.sync.start();
    expect(env.latest()).toMatchObject({
      status: "saved",
      settings: { accent: "neutral", language: "en", theme: "dark" },
    });
    expect(env.backend.save).toHaveBeenCalledOnce();
    env.sync.stop();
  });

  it("retains explicit edits when another window wins the empty-store initialization", async () => {
    const env = setup(DEFAULT_SETTINGS, { revision: 0, settings: {} });
    env.sync.update({ accent: "blue" });
    env.backend.save.mockImplementationOnce(async () => {
      env.send(snapshot(1, { language: "en", theme: "dark" }));
      throw { code: "SETTINGS_CONFLICT" };
    });
    await env.sync.start();
    expect(env.latest()).toMatchObject({
      status: "saved",
      settings: { accent: "blue", language: "en", theme: "dark" },
    });
    expect(env.backend.save.mock.calls.at(-1)).toEqual([
      settingsDocument({
        ...DEFAULT_SETTINGS,
        accent: "blue",
        language: "en",
        theme: "dark",
      }),
      1,
    ]);
    env.sync.stop();
  });

  it("keeps subscription failures visible while editing and subscribes again on retry", async () => {
    const env = setup(DEFAULT_SETTINGS, snapshot(2, { theme: "dark" }));
    env.backend.subscribe.mockRejectedValueOnce({ code: "STORAGE_IO" });
    await env.sync.start();
    env.sync.update({ accent: "rose" });
    expect(env.latest()).toMatchObject({
      status: "error",
      error: "STORAGE_IO",
      settings: { accent: "rose" },
    });
    expect(env.backend.load).not.toHaveBeenCalled();
    expect(env.backend.save).not.toHaveBeenCalled();
    await env.sync.retry();
    expect(env.backend.subscribe).toHaveBeenCalledTimes(2);
    expect(env.latest()).toMatchObject({
      status: "saved",
      error: null,
      settings: { theme: "dark", accent: "rose" },
    });
    env.sync.stop();
  });

  it("retains edits after a load failure without duplicating an existing subscription", async () => {
    const env = setup();
    env.backend.load.mockRejectedValueOnce(new Error("offline"));
    await env.sync.start();
    env.sync.update({ font: "mono" });
    expect(env.latest()).toMatchObject({
      status: "error",
      error: "STORAGE_UNAVAILABLE",
    });
    await env.sync.retry();
    expect(env.backend.subscribe).toHaveBeenCalledOnce();
    expect(env.latest()).toMatchObject({
      status: "saved",
      settings: { font: "mono" },
    });
    env.sync.stop();
  });

  it("preserves newer schemas through edits and retries until the user explicitly resets", async () => {
    const remote = {
      revision: 8,
      settings: { schemaVersion: 99, privateNewSetting: true },
    };
    const env = setup(DEFAULT_SETTINGS, remote);
    await env.sync.start();
    env.sync.update({ language: "en", theme: "dark" });
    await env.sync.retry();
    expect(env.latest()).toMatchObject({
      status: "error",
      error: "FUTURE_SETTINGS_VERSION",
      settings: { language: "en", theme: "dark" },
    });
    expect(env.backend.save).not.toHaveBeenCalled();
    env.sync.reset({ ...DEFAULT_SETTINGS, language: "en" });
    await vi.waitFor(() => expect(env.latest().status).toBe("saved"));
    expect(env.backend.save).toHaveBeenCalledExactlyOnceWith(
      settingsDocument({ ...DEFAULT_SETTINGS, language: "en" }),
      8,
    );
    env.sync.stop();
  });

  it("retains failed writes and newer edits when retry merges a remote change", async () => {
    const env = setup();
    await env.sync.start();
    env.backend.save.mockRejectedValueOnce({ code: "STORAGE_IO" });
    env.sync.update({ accent: "rose" });
    await vi.waitFor(() => expect(env.latest().status).toBe("error"));
    env.sync.update({ language: "en" });
    env.send(snapshot(2, { font: "mono" }));
    expect(env.latest()).toMatchObject({
      status: "error",
      settings: { accent: "rose", language: "en", font: "mono" },
    });
    expect(env.backend.save).toHaveBeenCalledOnce();
    await env.sync.retry();
    expect(env.latest()).toMatchObject({
      status: "saved",
      settings: { accent: "rose", language: "en", font: "mono" },
    });
    expect(env.backend.save.mock.calls.at(-1)).toEqual([
      settingsDocument({
        ...DEFAULT_SETTINGS,
        accent: "rose",
        language: "en",
        font: "mono",
      }),
      2,
    ]);
    env.sync.stop();
  });

  it("keeps newer local edits over the in-flight write and flushes them afterwards", async () => {
    const env = setup();
    await env.sync.start();
    const first = deferred<SettingsSnapshot>();
    env.backend.save.mockImplementationOnce(() => first.promise);
    env.sync.update({ accent: "rose" });
    env.sync.update({ accent: "blue", font: "mono" });
    expect(env.latest().settings).toMatchObject({
      accent: "blue",
      font: "mono",
    });
    env.send(snapshot(2, { accent: "rose" }));
    first.resolve(snapshot(2, { accent: "rose" }));
    await vi.waitFor(() => expect(env.latest().status).toBe("saved"));
    expect(env.backend.save.mock.calls.at(-1)).toEqual([
      settingsDocument({ ...DEFAULT_SETTINGS, accent: "blue", font: "mono" }),
      2,
    ]);
    expect(env.latest().settings).toMatchObject({
      accent: "blue",
      font: "mono",
    });
    env.sync.stop();
  });

  it("uses the newest remote revision if its event arrives before an older save response", async () => {
    const env = setup();
    await env.sync.start();
    const first = deferred<SettingsSnapshot>();
    env.backend.save.mockImplementationOnce(() => first.promise);
    env.sync.update({ accent: "rose" });
    env.send(snapshot(3, { accent: "emerald", theme: "dark" }));
    env.sync.update({ font: "mono" });
    first.resolve(snapshot(2, { accent: "rose" }));
    await vi.waitFor(() => expect(env.latest().status).toBe("saved"));
    expect(env.backend.save.mock.calls.at(-1)).toEqual([
      settingsDocument({
        ...DEFAULT_SETTINGS,
        accent: "emerald",
        theme: "dark",
        font: "mono",
      }),
      3,
    ]);
    env.sync.stop();
  });

  it("merges CAS conflicts without dropping local edits made while reloading", async () => {
    const env = setup();
    await env.sync.start();
    const reload = deferred<SettingsSnapshot>();
    env.backend.save.mockRejectedValueOnce({ code: "SETTINGS_CONFLICT" });
    env.backend.load.mockImplementationOnce(() => reload.promise);
    env.sync.update({ accent: "rose" });
    await vi.waitFor(() => expect(env.backend.load).toHaveBeenCalledTimes(2));
    env.sync.update({ accent: "blue" });
    const remote = snapshot(2, { font: "mono", theme: "dark" });
    env.send(remote);
    reload.resolve(remote);
    await vi.waitFor(() => expect(env.latest().status).toBe("saved"));
    expect(env.latest().settings).toMatchObject({
      accent: "blue",
      font: "mono",
      theme: "dark",
    });
    expect(env.backend.save).toHaveBeenCalledTimes(2);
    env.sync.stop();
  });

  it("bounds conflict retries and keeps unsaved data available for a later retry", async () => {
    const env = setup();
    await env.sync.start();
    env.backend.save.mockRejectedValue({ code: "SETTINGS_CONFLICT" });
    env.sync.update({ accent: "rose" });
    await vi.waitFor(() => expect(env.latest().status).toBe("error"));
    expect(env.latest()).toMatchObject({
      error: "SETTINGS_CONFLICT",
      settings: { accent: "rose" },
    });
    expect(env.backend.save).toHaveBeenCalledTimes(4);
    expect(env.sync.stop()).toEqual({ accent: "rose" });
  });

  it("preserves failed local fields if reloading after a conflict fails", async () => {
    const env = setup();
    await env.sync.start();
    env.backend.save.mockRejectedValueOnce({ code: "SETTINGS_CONFLICT" });
    env.backend.load.mockRejectedValueOnce({ code: "STORAGE_IO" });
    env.sync.update({ accent: "rose" });
    await vi.waitFor(() =>
      expect(env.latest()).toMatchObject({
        status: "error",
        error: "STORAGE_IO",
        settings: { accent: "rose" },
      }),
    );
    await env.sync.retry();
    expect(env.latest()).toMatchObject({
      status: "saved",
      settings: { accent: "rose" },
    });
    env.sync.stop();
  });

  it("keeps newer-schema events blocked even when an earlier write finishes", async () => {
    const env = setup();
    await env.sync.start();
    const save = deferred<SettingsSnapshot>();
    env.backend.save.mockImplementationOnce(() => save.promise);
    env.sync.update({ accent: "rose" });
    env.send({ revision: 3, settings: { schemaVersion: 99 } });
    env.sync.update({ font: "mono" });
    save.resolve(snapshot(2, { accent: "rose" }));
    await vi.waitFor(() => expect(env.backend.save).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(env.latest()).toMatchObject({
      status: "error",
      error: "FUTURE_SETTINGS_VERSION",
      settings: { font: "mono" },
    });
    env.sync.stop();
  });

  it("releases subscriptions that finish after cleanup and never loads or emits again", async () => {
    const env = setup();
    const subscription = deferred<() => void>();
    env.backend.subscribe.mockImplementationOnce(() => subscription.promise);
    const start = env.sync.start();
    await Promise.resolve();
    const count = env.states.length;
    env.sync.stop();
    subscription.resolve(env.stop);
    await start;
    expect(env.stop).toHaveBeenCalledOnce();
    expect(env.backend.load).not.toHaveBeenCalled();
    expect(env.states).toHaveLength(count);
    env.sync.update({ accent: "rose" });
    expect(env.states).toHaveLength(count);
  });

  it("returns the newest unsaved fields on cleanup and ignores a late write response", async () => {
    const env = setup();
    await env.sync.start();
    const save = deferred<SettingsSnapshot>();
    env.backend.save.mockImplementationOnce(() => save.promise);
    env.sync.update({ accent: "rose" });
    env.sync.update({ accent: "blue", font: "mono" });
    const count = env.states.length;
    expect(env.sync.stop()).toEqual({ accent: "blue", font: "mono" });
    save.resolve(snapshot(2, { accent: "rose" }));
    await Promise.resolve();
    expect(env.stop).toHaveBeenCalledOnce();
    expect(env.states).toHaveLength(count);
    expect(env.backend.save).toHaveBeenCalledOnce();
  });
});

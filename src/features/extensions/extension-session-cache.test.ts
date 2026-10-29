import { expect, it } from "vitest";
import { ExtensionSessionCache } from "./extension-session-cache";

function visit(cache: ExtensionSessionCache, key: string) {
  const session = cache.getOrCreate(key, key);
  cache.retain(session)();
  return session;
}

it("bounds clean sessions created by renders that never commit or acquire a lease", async () => {
  const cache = new ExtensionSessionCache(2);
  cache.getOrCreate("first", "first");
  cache.getOrCreate("second", "second");
  const third = cache.getOrCreate("third", "third");
  await Promise.resolve();
  expect([...cache.sessions.keys()]).toEqual(["second", "third"]);
  expect(cache.getOrCreate("third", "third")).toBe(third);
});

it("evicts the least recently visited clean session when the count budget is exceeded", async () => {
  const cache = new ExtensionSessionCache(2);
  const first = visit(cache, "first");
  visit(cache, "second");
  expect(visit(cache, "first")).toBe(first);
  const third = cache.getOrCreate("third", "third");
  const release = cache.retain(third);
  await Promise.resolve();
  expect([...cache.sessions.keys()]).toEqual(["first", "third"]);
  expect(cache.getOrCreate("second", "second").getSnapshot().view).toBeNull();
  release();
});

it("also evicts by retained payload bytes when the session count fits", async () => {
  const cache = new ExtensionSessionCache(12, 2048);
  visit(cache, "first").update({ uiState: "x".repeat(1200) });
  const second = visit(cache, "second");
  second.update({ uiState: "x".repeat(1200) });
  await Promise.resolve();
  expect([...cache.sessions.keys()]).toEqual(["second"]);
});

it("protects active, dirty and every kind of in-flight session until they become safely evictable", async () => {
  const cache = new ExtensionSessionCache(1, 1);
  const active = cache.getOrCreate("active", "active");
  const release = cache.retain(active);
  const dirty = visit(cache, "dirty");
  dirty.update({ dirty: true });
  const pending = visit(cache, "pending");
  const exporting = visit(cache, "exporting");
  const selecting = visit(cache, "selecting");
  const operation = new Promise<void>(() => {});
  pending.update({ pending: operation });
  exporting.update({ exporting: operation });
  selecting.update({ selecting: operation });
  visit(cache, "clean");
  await Promise.resolve();
  expect([...cache.sessions.keys()]).toEqual([
    "active",
    "dirty",
    "pending",
    "exporting",
    "selecting",
  ]);
  release();
  release();
  dirty.update({ dirty: false });
  pending.update({ pending: null });
  exporting.update({ exporting: null });
  selecting.update({ selecting: null });
  await Promise.resolve();
  expect(cache.sessions.size).toBe(0);
});

it("does not evict during StrictMode's immediate release and reacquire", async () => {
  const cache = new ExtensionSessionCache(0, 0);
  const session = cache.getOrCreate("current", "current");
  cache.retain(session)();
  const release = cache.retain(session);
  await Promise.resolve();
  expect(cache.getOrCreate("current", "current")).toBe(session);
  release();
  await Promise.resolve();
  expect(cache.sessions.size).toBe(0);
});

it("reattaches the same session if an idle trim happens before its render commits", async () => {
  const cache = new ExtensionSessionCache(0, 0);
  const session = visit(cache, "current");
  await Promise.resolve();
  expect(cache.sessions.has("current")).toBe(false);
  const release = cache.retain(session);
  await Promise.resolve();
  expect(cache.sessions.get("current")).toBe(session);
  release();
});

it("isolates replacement identities while preserving retired dirty work until it is resolved", async () => {
  const cache = new ExtensionSessionCache();
  const old = visit(cache, "app");
  old.update({ dirty: true, fields: { draft: "Old installation" } });
  cache.reconcile((_key, state) => state.identity === "replacement");
  const replacement = cache.getOrCreate("app", "replacement");
  const release = cache.retain(replacement);
  await Promise.resolve();
  expect(cache.sessions.get("app")).toBe(replacement);
  expect(old.getSnapshot().fields.draft).toBe("Old installation");
  old.update({ dirty: false });
  await Promise.resolve();
  expect(cache.sessions.get("app")).toBe(replacement);
  expect(replacement.getSnapshot().fields).toEqual({});
  release();
});

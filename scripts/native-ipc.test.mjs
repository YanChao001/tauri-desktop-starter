import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const source = (
  await readFile(
    new URL("../src-tauri/src/native-ipc.js", import.meta.url),
    "utf8",
  )
)
  .replaceAll("__INVOKE_KEY__", JSON.stringify("test-only-invoke-key"))
  .replaceAll("__STARTER_OS_NAME__", JSON.stringify("windows"));
function environment(child, fetch) {
  const calls = [],
    replies = [],
    warnings = [];
  const context = createContext({
    Headers,
    fetch,
    console: { warn: (...args) => warnings.push(args) },
    collect: (value) => calls.push(JSON.parse(value)),
    reply: (...args) => replies.push(args),
  });
  runInContext(
    `
    window = globalThis; window.top = ${child ? "{}" : "window"};
    window.ipc = { postMessage: collect };
    window.__TAURI_INTERNALS__ = {
      convertFileSrc: (command) => 'http://ipc.localhost/' + command,
      runCallback: reply,
    };
  `,
    context,
  );
  runInContext(source, context);
  return { context, calls, replies, warnings };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("child frames never acquire keyed native IPC even when core globals exist", () => {
  const env = environment(true, () =>
    assert.fail("Child invoked native fetch"),
  );
  assert.equal(
    runInContext("typeof window.__TAURI_INTERNALS__.postMessage", env.context),
    "undefined",
  );
  assert.deepEqual(env.calls, []);
});

test("host transport preserves Tauri serialization, response callbacks and private key", async () => {
  const requests = [];
  const env = environment(false, async (url, options) => {
    requests.push({ url, options });
    return {
      headers: new Headers({
        "Tauri-Response": "ok",
        "Content-Type": "application/json",
      }),
      json: async () => ({ saved: true }),
    };
  });
  runInContext(
    `window.__TAURI_INTERNALS__.postMessage({
    cmd: 'test_command', callback: 1, error: 2,
    payload: { map: new Map([['x', 1]]), bytes: new Uint8Array([1,2]),
      buffer: new Uint8Array([3,4]).buffer, custom: { __TAURI_TO_IPC_KEY__() { return 'resource-id' } } }
  })`,
    env.context,
  );
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].options.headers.get("Tauri-Invoke-Key"),
    "test-only-invoke-key",
  );
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    map: { x: 1 },
    bytes: [1, 2],
    buffer: [3, 4],
    custom: "resource-id",
  });
  assert.deepEqual(env.replies, [[1, { saved: true }]]);
  assert.equal(
    runInContext(
      "window.__TAURI_INTERNALS__.postMessage.toString().includes('test-only-invoke-key')",
      env.context,
    ),
    false,
  );
});

test("host transport retains postMessage fallback when custom protocol fetch fails", async () => {
  const env = environment(false, async () => {
    throw new Error("blocked protocol");
  });
  runInContext(
    "window.__TAURI_INTERNALS__.postMessage({cmd:'save',callback:1,error:2,payload:{bytes:new Uint8Array([5,6])}})",
    env.context,
  );
  await tick();
  assert.equal(env.warnings.length, 1);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].__TAURI_INVOKE_KEY__, "test-only-invoke-key");
  assert.equal(env.calls[0].options.customProtocolIpcBlocked, true);
  assert.deepEqual(env.calls[0].payload.bytes, [5, 6]);
});

test("host transport preserves binary request bodies and error callbacks", async () => {
  let request;
  const env = environment(false, async (_url, options) => {
    request = options;
    return {
      headers: new Headers({
        "Tauri-Response": "error",
        "Content-Type": "text/plain",
      }),
      text: async () => "rejected",
    };
  });
  runInContext(
    "window.__TAURI_INTERNALS__.postMessage({cmd:'binary',callback:1,error:2,payload:new Uint8Array([7,8])})",
    env.context,
  );
  await tick();
  assert.equal(request.headers.get("Content-Type"), "application/octet-stream");
  assert.deepEqual(Array.from(request.body), [7, 8]);
  assert.deepEqual(env.replies, [[2, "rejected"]]);
});

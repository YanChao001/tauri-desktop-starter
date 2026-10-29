import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import ts from "typescript";

const source = await readFile(
  new URL("../sdk/extension-ui.js", import.meta.url),
  "utf8",
);
const sharedStyles = `@layer starter-defaults {\n${await readFile(new URL("../src/styles/surface-tokens.css", import.meta.url), "utf8")}\n${await readFile(new URL("../src/styles/control-styles.css", import.meta.url), "utf8")}\n}`;
function fixture({
  reduced = false,
  schedule = setTimeout,
  unschedule = clearTimeout,
} = {}) {
  const messages = [],
    parentMessages = [],
    frames = [],
    documentEvents = new Map(),
    errors = [],
    events = new Map(),
    tokens = new Map(),
    classes = new Set();
  const styles = [];
  const parent = {
    postMessage: (value) =>
      parentMessages.push(JSON.parse(JSON.stringify(value))),
  };
  const root = {
    dataset: {},
    style: {
      setProperty: (key, value) => tokens.set(key, value),
      removeProperty: (key) => tokens.delete(key),
    },
    classList: {
      toggle: (name, enabled) =>
        enabled ? classes.add(name) : classes.delete(name),
    },
    prepend() {},
  };
  const document = {
    readyState: "complete",
    documentElement: root,
    head: { prepend() {} },
    createElement: () => {
      const style = {
        dataset: {},
        textContent: "",
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      styles.push(style);
      return style;
    },
    addEventListener: (name, listener) => documentEvents.set(name, listener),
    removeEventListener: (name) => documentEvents.delete(name),
  };
  const window = {
    top: {},
    matchMedia: () => ({ matches: reduced }),
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name) => events.delete(name),
    requestAnimationFrame: (callback) => frames.push(callback),
  };
  const port = {
    postMessage: (value) => messages.push(JSON.parse(JSON.stringify(value))),
    start() {},
    closed: 0,
    close() {
      this.closed++;
    },
    onmessage: null,
    onmessageerror: null,
  };
  vm.runInNewContext(source, {
    window,
    parent,
    document,
    location: { protocol: "extension-ui:", hostname: "extension-ui.localhost" },
    structuredClone,
    performance,
    setTimeout: schedule,
    clearTimeout: unschedule,
    TextEncoder,
    console: { error: (message) => errors.push(message) },
  });
  events.get("message")({
    source: parent,
    data: { type: "starter:connect", version: 1 },
    ports: [port],
  });
  const send = (value) => port.onmessage?.({ data: value });
  const close = () => send({ type: "closed" });
  return {
    sdk: window.starter,
    port,
    events,
    document,
    root,
    tokens,
    classes,
    styles,
    send,
    close,
    messages,
    parentMessages,
    frame: () => frames.splice(0).forEach((callback) => callback()),
    documentEvents,
    errors,
  };
}

test("resource, link and window SDK types expose typed receipts and reject unknown services, actions, paths and identities", () => {
  const filename = fileURLToPath(
    new URL("../sdk/service-types.fixture.ts", import.meta.url),
  ).replaceAll("\\", "/");
  const fixtureSource = `
    import type { ExtensionUiApi, ExtensionResourceRequest, ExtensionWindowRequest, ExtensionWindowState } from "./extension-ui";
    declare const sdk: ExtensionUiApi;
    async function contract() {
      const image = await sdk.services.request("resources", { action: "fetch-image", url: "https://example.com/image.jpg", networkMode: "system" });
      const bytes: number = image.bytes;
      const preview = await sdk.services.request("resources", { action: "preview", resourceId: image.resourceId });
      const dataUrl: string = preview.dataUrl;
      const saved = await sdk.services.request("resources", { action: "save", resourceId: image.resourceId, name: "photo.jpg" });
      if (!saved.cancelled) { const name: string = saved.name; void name; }
      const released: null = await sdk.services.request("resources", { action: "release", resourceId: image.resourceId });
      const opened: null = await sdk.services.request("links", { url: "https://example.com" });
      const legacy: unknown = await sdk.services.request("lan", { action: "status" });
      const wallpaper: unknown = await sdk.services.request("wallpaper", { action: "list" });
      const windowState: ExtensionWindowState = await sdk.services.request("window", { action: "get-state" });
      const pinned: boolean = windowState.alwaysOnTop;
      const windowRequest: ExtensionWindowRequest = { action: "set-always-on-top", enabled: true };
      const updated: ExtensionWindowState = await sdk.services.request("window", windowRequest);
      declareRequest({ action: "save", resourceId: "resource" });
      // @ts-expect-error 资源回执不暴露系统路径。
      image.path;
      // @ts-expect-error 只允许注册的服务。
      sdk.services.request("shell", { command: "run" });
      // @ts-expect-error 资源服务不提供任意动作。
      sdk.services.request("resources", { action: "execute", resourceId: "resource" });
      // @ts-expect-error 保存目标由用户通过系统对话框选择。
      sdk.services.request("resources", { action: "save", resourceId: "resource", path: "C:/file.jpg" });
      // @ts-expect-error 界面不能自述原生身份。
      sdk.services.request("links", { url: "https://example.com", expectedGeneration: 2 });
      // @ts-expect-error 插件不能传入任意代理。
      sdk.services.request("resources", { action: "fetch-image", url: "https://example.com", networkMode: "http://proxy" });
      // @ts-expect-error 窗口服务只允许读取状态和切换置顶。
      sdk.services.request("window", { action: "close" });
      // @ts-expect-error 置顶值必须是布尔值。
      sdk.services.request("window", { action: "set-always-on-top", enabled: "true" });
      // @ts-expect-error 窗口由已认证的原生调用者确定。
      sdk.services.request("window", { action: "get-state", label: "main" });
      // @ts-expect-error 窗口服务不接受系统路径。
      sdk.services.request("window", { action: "get-state", path: "C:/file" });
      // @ts-expect-error 插件不能自述原生身份。
      sdk.services.request("window", { action: "set-always-on-top", enabled: true, id: "forged" });
      // @ts-expect-error 原生调用代次由宿主提供。
      sdk.services.request("window", { action: "get-state", expectedGeneration: 3 });
      return { bytes, dataUrl, released, opened, legacy, wallpaper, pinned, updated };
    }
    function declareRequest(value: ExtensionResourceRequest) { return value; }
    void contract;
  `;
  const options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, ...args) =>
    path === filename
      ? ts.createSourceFile(path, fixtureSource, options.target, true)
      : readSourceFile(path, ...args);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
  );
});

test("resources, links and window share the existing service channel without supplying native identity", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const cases = [
    {
      service: "resources",
      value: { action: "fetch-image", url: "https://images.example.com/a.jpg" },
      result: {
        resourceId: "one",
        mime: "image/jpeg",
        bytes: 8,
        width: 1,
        height: 1,
        sha256: "a".repeat(64),
      },
    },
    {
      service: "resources",
      value: {
        action: "fetch-image",
        url: "https://images.example.com/a.jpg",
        networkMode: "system",
      },
      result: { resourceId: "two" },
    },
    {
      service: "resources",
      value: { action: "preview", resourceId: "one" },
      result: { dataUrl: "data:image/jpeg;base64,YQ==" },
    },
    {
      service: "resources",
      value: { action: "save", resourceId: "one", name: "photo.jpg" },
      result: { cancelled: true },
    },
    {
      service: "resources",
      value: { action: "release", resourceId: "one" },
      result: null,
    },
    {
      service: "links",
      value: { url: "https://source.example.com/article" },
      result: null,
    },
    {
      service: "window",
      value: { action: "get-state" },
      result: { alwaysOnTop: false },
    },
    {
      service: "window",
      value: { action: "set-always-on-top", enabled: true },
      result: { alwaysOnTop: true },
    },
    {
      service: "window",
      value: { action: "set-always-on-top", enabled: false },
      result: { alwaysOnTop: false },
    },
  ];
  for (const [index, entry] of cases.entries()) {
    const receipt = sdk.services.request(entry.service, entry.value);
    await Promise.resolve();
    assert.deepEqual(messages.at(-1), {
      version: 1,
      id: index + 1,
      method: "service",
      params: { service: entry.service, request: entry.value },
    });
    send({ id: index + 1, result: entry.result });
    assert.deepEqual(await receipt, entry.result);
  }
  await assert.rejects(
    sdk.services.request("shell", {}),
    (error) => error.code === "INVALID_ARGUMENT" && error.retryable === false,
  );
  assert.equal(messages.length, cases.length);
  const stillConnected = sdk.services.request("links", {
    url: "https://example.com",
  });
  await Promise.resolve();
  send({ id: cases.length + 1, result: null });
  assert.equal(await stillConnected, null);
  close();
});

test("window SDK rejects malformed requests, paths and forged identity before sending them", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  for (const value of [
    null,
    [],
    {},
    { action: "close" },
    { action: "get-state", enabled: true },
    { action: "get-state", label: "main" },
    { action: "get-state", path: "C:/file" },
    { action: "get-state", expectedGeneration: 2 },
    { action: "set-always-on-top" },
    { action: "set-always-on-top", enabled: "true" },
    { action: "set-always-on-top", enabled: true, id: "forged" },
  ])
    await assert.rejects(
      sdk.services.request("window", value),
      (error) => error.code === "INVALID_ARGUMENT" && error.retryable === false,
    );
  assert.equal(messages.length, 0);
  const receipt = sdk.services.request("window", { action: "get-state" });
  await Promise.resolve();
  send({ id: 1, result: { alwaysOnTop: false } });
  assert.deepEqual(await receipt, { alwaysOnTop: false });
  close();
});

test("32-field drafts reach the host intact and a host rejection of 33 fields preserves the channel", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const fields = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [`field${index}`, String(index)]),
  );
  for (const method of ["run", "fields"]) {
    const execute = (value) =>
      method === "run" ? sdk.run("convert", value) : sdk.setFields(value);
    const accepted = execute(fields);
    await Promise.resolve();
    const id = messages.length;
    assert.deepEqual(messages.at(-1), {
      version: 1,
      id,
      method,
      params: method === "run" ? { action: "convert", fields } : { fields },
    });
    const result = method === "run" ? { state: "converted", fields: [] } : null;
    send({ id, result });
    assert.deepEqual(await accepted, result);

    // 数量校验属于宿主；SDK 保留宿主错误，不维护第二套字段额度。
    const extra = { ...fields, field32: "32" };
    const rejected = execute(extra);
    await Promise.resolve();
    assert.deepEqual(messages.at(-1).params.fields, extra);
    send({
      id: id + 1,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Too many form fields",
        retryable: false,
      },
    });
    await assert.rejects(rejected, {
      code: "INVALID_ARGUMENT",
      message: "Too many form fields",
      retryable: false,
    });
  }
  const corrected = sdk.setFields(fields);
  await Promise.resolve();
  assert.equal(messages.length, 5);
  send({ id: 5, result: null });
  await corrected;
  close();
});

test("resource and link requests share the four-operation limit and reject unfinished work on closure", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const pending = [
    sdk.services.request("resources", { action: "preview", resourceId: "one" }),
    sdk.services.request("links", { url: "https://example.com" }),
    sdk.services.request("lan", { action: "status" }),
    sdk.run("refresh"),
  ];
  await Promise.resolve();
  await assert.rejects(
    sdk.services.request("resources", { action: "save", resourceId: "one" }),
    (error) => error.code === "EXTENSION_BUSY" && error.retryable === true,
  );
  assert.equal(messages.length, 4);
  send({ id: 1, result: { dataUrl: "data:image/png;base64,YQ==" } });
  await pending.shift();
  pending.push(
    sdk.services.request("resources", { action: "save", resourceId: "one" }),
  );
  await Promise.resolve();
  assert.equal(messages.length, 5);
  assert.equal(messages.at(-1).id, 5);
  const rejected = pending.map((operation) =>
    assert.rejects(
      operation,
      (error) => error.code === "EXTENSION_UNAVAILABLE",
    ),
  );
  close();
  await Promise.all(rejected);
});

test("a busy host receipt keeps the connection usable without automatically retrying", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const operation = sdk.services.request("resources", {
    action: "fetch-image",
    url: "https://example.com/image.jpg",
  });
  await Promise.resolve();
  send({
    id: 1,
    error: {
      code: "EXTENSION_BUSY",
      message: "Extension bridge is busy",
      retryable: true,
    },
  });
  await assert.rejects(operation, {
    code: "EXTENSION_BUSY",
    retryable: true,
  });
  await Promise.resolve();
  assert.equal(messages.length, 1);
  const next = sdk.setFields({ source: "next" });
  await Promise.resolve();
  assert.equal(messages.at(-1).id, 2);
  send({ id: 2, result: null });
  assert.equal(await next, null);
  close();
});

test("closure before the first state rejects readiness and waiting requests, and releases the channel", async () => {
  const { sdk, port, events, documentEvents, messages, close } = fixture();
  const unavailable = (error) =>
    error.code === "EXTENSION_UNAVAILABLE" && error.retryable === false;
  const ready = assert.rejects(sdk.ready, unavailable);
  const request = assert.rejects(sdk.run("initialize"), unavailable);
  close();
  await Promise.all([ready, request]);
  assert.equal(port.onmessage, null);
  assert.equal(port.onmessageerror, null);
  assert.equal(port.closed, 1);
  assert.deepEqual([...events.keys()], ["contextmenu"]);
  assert.equal(documentEvents.size, 0);
  assert.deepEqual(messages, []);
  await assert.rejects(sdk.setFields({ draft: "late" }), unavailable);
});

test("unused readiness can be rejected on closure without an unhandled rejection", async () => {
  const { close } = fixture();
  close();
  await new Promise(setImmediate);
});

test("an unreadable channel message terminates both initialization and active requests", async () => {
  const invalid = (error) =>
    error.code === "INVALID_ARGUMENT" && error.retryable === false;
  const initial = fixture();
  const ready = assert.rejects(initial.sdk.ready, invalid);
  const waiting = assert.rejects(
    initial.sdk.services.request("lan", { action: "status" }),
    invalid,
  );
  initial.port.onmessageerror({});
  await Promise.all([ready, waiting]);
  assert.equal(initial.port.closed, 1);

  const active = fixture();
  let changes = 0;
  active.sdk.onChange(() => changes++);
  active.send({ type: "state", value: snapshot() });
  await active.sdk.ready;
  const pending = active.sdk.saveArtifact(0);
  await Promise.resolve();
  const rejected = assert.rejects(pending, invalid);
  const messageError = active.port.onmessageerror;
  messageError({});
  messageError({});
  await rejected;
  assert.equal(active.port.closed, 1);
  assert.equal(active.port.onmessage, null);
  assert.equal(active.port.onmessageerror, null);
  assert.deepEqual([...active.events.keys()], ["contextmenu"]);
  assert.equal(active.documentEvents.size, 0);
  active.sdk.onChange(() => changes++);
  active.send({ type: "state", value: snapshot() });
  assert.equal(changes, 1);
  await assert.rejects(
    active.sdk.notify("late"),
    (error) => error.code === "EXTENSION_UNAVAILABLE",
  );
});

test("the first visible-frame acknowledgement waits for a real view, document readiness and author rendering", () => {
  const { document, documentEvents, send, parentMessages, frame, root, close } =
    fixture();
  document.readyState = "loading";
  send({
    type: "state",
    value: snapshot({ theme: { mode: "dark", tokens: {} } }),
  });
  frame();
  frame();
  assert.equal(root.style.colorScheme, "dark");
  assert.deepEqual(
    parentMessages.map((message) => message.type),
    ["starter:ready"],
  );
  send({
    type: "state",
    value: snapshot({
      view: { state: "rendered" },
      theme: { mode: "dark", tokens: {} },
    }),
  });
  frame();
  frame();
  assert.equal(parentMessages.length, 1);
  document.readyState = "interactive";
  documentEvents.get("DOMContentLoaded")();
  frame();
  assert.equal(parentMessages.length, 1);
  frame();
  assert.deepEqual(parentMessages.at(-1), {
    type: "starter:painted",
    version: 1,
  });
  send({ type: "state", value: snapshot({ view: { state: "updated" } }) });
  frame();
  frame();
  assert.equal(
    parentMessages.filter((message) => message.type === "starter:painted")
      .length,
    1,
  );
  close();
});

test("the first paint commits the host theme before restoring normal CSS transitions", () => {
  const { root, styles, tokens, send, frame, parentMessages, close } =
    fixture();
  const initialPaint = styles.find((style) =>
    Object.hasOwn(style.dataset, "starterInitialPaint"),
  );
  assert.ok(initialPaint);
  assert.match(initialPaint.textContent, /transition:none !important/);
  let commits = 0;
  Object.defineProperty(root, "offsetWidth", {
    get() {
      commits++;
      assert.equal(initialPaint.removed, false);
      assert.equal(tokens.get("--background"), "#0a0a0a");
      assert.equal(root.style.colorScheme, "dark");
      return 800;
    },
  });
  send({
    type: "state",
    value: snapshot({
      view: { state: "rendered" },
      theme: { mode: "dark", tokens: { "--background": "#0a0a0a" } },
    }),
  });
  frame();
  assert.equal(initialPaint.removed, false);
  assert.equal(commits, 0);
  frame();
  assert.equal(commits, 1);
  assert.equal(initialPaint.removed, true);
  assert.equal(parentMessages.at(-1).type, "starter:painted");
  send({
    type: "state",
    value: snapshot({
      view: { state: "rendered" },
      theme: { mode: "light", tokens: { "--background": "white" } },
    }),
  });
  frame();
  frame();
  assert.equal(commits, 1);
  assert.equal(initialPaint.removed, true);
  assert.equal(root.style.colorScheme, "light");
  close();
});
function snapshot(overrides = {}) {
  return {
    view: null,
    fields: {},
    checkpoint: null,
    busy: false,
    dirty: false,
    locale: "en",
    grantedPermissions: [],
    ...overrides,
    theme: {
      mode: "light",
      motion: "full",
      tokens: { "--host-font-size": "17px", "--primary": "blue" },
      styles: sharedStyles,
      ...overrides.theme,
    },
  };
}

test("checkpoint encoding errors reject the returned promise without sending or closing the bridge", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const circular = {};
  circular.self = circular;
  for (const value of [circular, { count: 1n }]) {
    let checkpoint;
    assert.doesNotThrow(() => {
      checkpoint = sdk.checkpoint(value, true);
    });
    await assert.rejects(checkpoint, { name: "TypeError" });
  }
  assert.equal(messages.length, 0);
  const saved = sdk.checkpoint({ draft: "retained" }, true);
  await Promise.resolve();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].method, "checkpoint");
  assert.deepEqual(messages[0].params, {
    value: JSON.stringify({ draft: "retained" }),
    dirty: true,
  });
  send({ id: messages[0].id, result: null });
  await saved;
  close();
});

test("incremental state patches preserve complete isolated author snapshots", async () => {
  const { sdk, send, close } = fixture();
  const observed = [];
  sdk.onChange((state) => {
    state.view.state = "author mutation";
    state.theme.mode = "author mutation";
  });
  sdk.onChange((state) => observed.push(state));
  send({
    type: "state",
    value: snapshot({ view: { state: "retained view" } }),
  });
  await sdk.ready;
  send({ type: "state", value: { fields: { query: "edited" }, dirty: true } });
  send({
    type: "state",
    value: { checkpoint: { draft: "saved" }, busy: true },
  });
  assert.equal(observed.at(-1).view.state, "retained view");
  assert.equal(observed.at(-1).theme.mode, "light");
  assert.deepEqual(observed.at(-1).fields, { query: "edited" });
  assert.deepEqual(observed.at(-1).checkpoint, { draft: "saved" });
  assert.equal(observed.at(-1).dirty, true);
  assert.equal(observed.at(-1).busy, true);
  close();
});

test("surface activity defaults to active and rejects new hidden requests while existing receipts still complete", async () => {
  const { sdk, root, send, messages, close } = fixture();
  const observed = [];
  sdk.onChange((state) => observed.push(state));
  send({ type: "state", value: snapshot() });
  assert.equal((await sdk.ready).active, true);
  assert.equal(root.dataset.active, "true");
  const pending = sdk.services.request("lan", { action: "status" });
  await Promise.resolve();
  assert.equal(messages.length, 1);

  send({ type: "state", value: { active: false } });
  assert.equal(observed.at(-1).active, false);
  assert.equal(root.dataset.active, "false");
  assert.equal(root.dataset.motion, "full");
  for (const request of [
    sdk.run("refresh"),
    sdk.setFields({ draft: "retained" }),
    sdk.checkpoint({ draft: "retained" }, true),
    sdk.saveArtifact(0),
    sdk.notify("hidden"),
    sdk.services.request("lan", { action: "status" }),
  ])
    await assert.rejects(request, { code: "EXTENSION_UNAVAILABLE" });
  assert.equal(messages.length, 1);
  send({ id: 1, result: { connected: true } });
  assert.deepEqual(await pending, { connected: true });

  send({ type: "state", value: { busy: true } });
  assert.equal(observed.at(-1).active, false);
  send({ type: "state", value: { active: true } });
  assert.equal(observed.at(-1).active, true);
  assert.equal(root.dataset.active, "true");
  const resumed = sdk.notify("resumed");
  await Promise.resolve();
  assert.equal(messages.length, 2);
  send({ id: 2, result: null });
  await resumed;
  close();
});

test("an initially inactive surface still becomes ready without allowing requests", async () => {
  const { sdk, send, messages, close } = fixture();
  send({ type: "state", value: snapshot({ active: false }) });
  assert.equal((await sdk.ready).active, false);
  await assert.rejects(sdk.notify("hidden"), { code: "EXTENSION_UNAVAILABLE" });
  assert.equal(messages.length, 0);
  close();
});

test("SDK follows locale, host font tokens and theme without overwriting author font properties", async () => {
  const { sdk, root, tokens, classes, send, close } = fixture();
  const observed = [];
  sdk.onChange((state) => observed.push(state.locale));
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  root.style.fontFamily = "Author custom font";
  send({
    type: "state",
    value: snapshot({
      locale: "zh-CN",
      theme: {
        mode: "dark",
        motion: "reduced",
        tokens: { "--host-font-size": "14px", "--input": "gray" },
      },
    }),
  });
  assert.deepEqual(observed, ["en", "zh-CN"]);
  assert.equal(root.lang, "zh-CN");
  assert.equal(root.dataset.motion, "reduced");
  assert.equal(root.style.fontFamily, "Author custom font");
  assert.equal(root.style.fontSize, undefined);
  assert.equal(tokens.get("--host-font-size"), "14px");
  assert.ok(classes.has("dark"));
  close();
});

test("a broken author subscriber does not prevent readiness, other subscribers or service replies", async () => {
  const { sdk, send, close, messages, errors } = fixture();
  let received = 0;
  sdk.onChange(() => {
    throw Error("Author render failed");
  });
  sdk.onChange(() => received++);
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  assert.equal(received, 1);
  assert.equal(errors.length, 1);
  const request = sdk.services.request("lan", { operation: "status" });
  await Promise.resolve();
  assert.deepEqual(messages, [
    {
      version: 1,
      id: 1,
      method: "service",
      params: { service: "lan", request: { operation: "status" } },
    },
  ]);
  send({ id: 1, result: { connected: false } });
  assert.deepEqual(await request, { connected: false });
  const denied = sdk.services.request("wallpaper", { operation: "apply" });
  await Promise.resolve();
  send({
    id: 2,
    error: {
      code: "PERMISSION_DENIED",
      message: "Extension operation failed",
      retryable: false,
    },
  });
  await assert.rejects(
    denied,
    (error) => error.code === "PERMISSION_DENIED" && error.retryable === false,
  );
  close();
});

test("notifications use the same bounded channel, default to info and stop after surface closure", async () => {
  const { sdk, send, close, messages } = fixture();
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const notification = sdk.notify("搜索失败，请重试。", { tone: "error" });
  await Promise.resolve();
  assert.deepEqual(messages, [
    {
      version: 1,
      id: 1,
      method: "notify",
      params: { message: "搜索失败，请重试。", tone: "error" },
    },
  ]);
  send({ id: 1, result: null });
  await notification;
  const defaultNotification = sdk.notify("Ready");
  await Promise.resolve();
  assert.deepEqual(messages.at(-1).params, { message: "Ready", tone: "info" });
  send({ id: 2, result: null });
  await defaultNotification;
  const waiting = sdk.notify("Saved", { tone: "success" });
  await Promise.resolve();
  close();
  await assert.rejects(waiting, /Extension surface closed/);
  await assert.rejects(sdk.notify("Too late"), /Extension bridge unavailable/);
  assert.equal(messages.length, 3);
});

test("opaque child reveals use host coordinates and keep later state updates while animation is active", async () => {
  const { sdk, document, root, send, close } = fixture();
  const animations = [],
    observed = [];
  root.animate = (frames, options) => {
    const animation = { currentTime: 0 };
    animations.push({ frames, options, animation });
    return animation;
  };
  let finish, startUpdate;
  document.startViewTransition = (update) => ({
    ready: new Promise((resolve) => {
      startUpdate = () => resolve(update());
    }),
    finished: new Promise((resolve) => {
      finish = resolve;
    }),
    skipTransition() {
      finish();
    },
  });
  sdk.onChange((state) => observed.push(state.fields.value));
  send({ type: "state", value: snapshot({ fields: { value: "draft" } }) });
  await sdk.ready;
  send({
    type: "theme-transition",
    value: {
      x: -150,
      y: -30,
      radius: 1400,
      duration: 520,
      easing: "ease-in-out",
      startedAt: performance.timeOrigin + performance.now() - 20,
    },
  });
  send({
    type: "state",
    value: snapshot({
      fields: { value: "draft" },
      theme: { mode: "dark", motion: "full", tokens: {} },
    }),
  });
  send({ type: "state", value: { fields: { value: "before commit" } } });
  assert.equal(root.style.colorScheme, "light");
  startUpdate();
  await new Promise(setImmediate);
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(observed.at(-1), "before commit");
  assert.equal(animations.length, 1);
  assert.deepEqual(Array.from(animations[0].frames.clipPath), [
    "circle(0px at -150px -30px)",
    "circle(1400px at -150px -30px)",
  ]);
  assert.equal(animations[0].options.duration, 520);
  assert.ok(animations[0].animation.currentTime >= 20);
  send({
    type: "state",
    value: { fields: { value: "new draft" } },
  });
  assert.equal(observed.at(-1), "new draft");
  close();
});

test("a theme reverting before the reveal callback commits the latest fields and environment", async () => {
  const { sdk, document, root, send, close } = fixture();
  let startUpdate, finish;
  root.animate = () => ({ currentTime: 0 });
  document.startViewTransition = (update) => ({
    ready: new Promise((resolve) => {
      startUpdate = () => resolve(update());
    }),
    finished: new Promise((resolve) => {
      finish = resolve;
    }),
    skipTransition() {
      finish();
    },
  });
  const observed = [];
  sdk.onChange((state) => observed.push(state));
  send({ type: "state", value: snapshot({ fields: { value: "initial" } }) });
  await sdk.ready;
  send({ type: "theme-transition", value: {} });
  send({
    type: "state",
    value: {
      fields: { value: "older" },
      theme: { mode: "dark", motion: "full", tokens: {} },
    },
  });
  // 主题菜单的显式选择可直接回到原模式，不会准备第二次圆形过渡。
  send({
    type: "state",
    value: {
      fields: { value: "latest" },
      theme: { mode: "light", motion: "full", tokens: {} },
      locale: "zh-CN",
    },
  });
  startUpdate();
  await new Promise(setImmediate);
  assert.equal(root.style.colorScheme, "light");
  assert.equal(root.dataset.motion, "full");
  assert.equal(root.lang, "zh-CN");
  assert.equal(observed.at(-1).fields.value, "latest");
  close();
});

test("reduced motion applies a theme change without starting a child view transition", async () => {
  const { sdk, document, root, send, close } = fixture({ reduced: true });
  let started = false;
  root.animate = () => {};
  document.startViewTransition = () => {
    started = true;
  };
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  send({ type: "theme-transition", value: {} });
  send({
    type: "state",
    value: snapshot({ theme: { mode: "dark", motion: "full", tokens: {} } }),
  });
  assert.equal(started, false);
  assert.equal(root.style.colorScheme, "dark");
  close();
});

test("surface deactivation cancels pending and running reveals and applies the latest snapshot immediately", async () => {
  for (const commitFirst of [false, true]) {
    const { sdk, document, root, send, close } = fixture();
    const observed = [];
    let startUpdate, finish;
    let started = 0,
      cancelled = 0,
      skipped = 0;
    root.animate = () => {
      started++;
      return {
        currentTime: 0,
        cancel() {
          cancelled++;
        },
      };
    };
    document.startViewTransition = (update) => ({
      ready: new Promise((resolve) => {
        startUpdate = () => resolve(update());
      }),
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
      skipTransition() {
        skipped++;
        finish();
      },
    });
    sdk.onChange((state) => observed.push(state));
    send({ type: "state", value: snapshot() });
    await sdk.ready;
    send({ type: "theme-transition", value: {} });
    send({
      type: "state",
      value: { theme: { mode: "dark", motion: "full", tokens: {} } },
    });
    if (commitFirst) {
      startUpdate();
      await new Promise(setImmediate);
      assert.equal(started, 1);
    }
    send({
      type: "state",
      value: { active: false, fields: { value: "latest" } },
    });
    assert.equal(root.style.colorScheme, "dark");
    assert.equal(root.dataset.active, "false");
    assert.equal(root.dataset.motion, "full");
    assert.equal(observed.at(-1).fields.value, "latest");
    assert.equal(observed.at(-1).active, false);
    assert.equal(skipped, 1);
    assert.equal(cancelled, commitFirst ? 1 : 0);
    if (!commitFirst) {
      startUpdate();
      await new Promise(setImmediate);
      assert.equal(started, 0);
    }
    send({ type: "theme-transition", value: {} });
    send({
      type: "state",
      value: { theme: { mode: "light", motion: "full", tokens: {} } },
    });
    assert.equal(root.style.colorScheme, "light");
    assert.equal(skipped, 1);
    close();
  }
});

test("a native dialog stays pending until the actual reply and closing the surface rejects unfinished requests", async () => {
  const timers = new Map();
  let nextTimer = 0;
  const { sdk, send, close } = fixture({
    schedule: (callback, delay) => {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    unschedule: (id) => timers.delete(id),
  });
  send({ type: "state", value: snapshot() });
  await sdk.ready;
  const imported = sdk.services.request("wallpaper", { action: "import" });
  let settled = false;
  void imported.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  for (const { callback, delay } of [...timers.values()])
    if (delay <= 120000) callback();
  await Promise.resolve();
  assert.equal(settled, false);
  send({ id: 1, result: { cancelled: false } });
  assert.deepEqual(await imported, { cancelled: false });
  const waiting = sdk.saveArtifact(0);
  await Promise.resolve();
  close();
  await assert.rejects(waiting, /Extension surface closed/);
});

function selectFixture({
  url = "https://extension-ui.localhost/main",
  browserFixture = false,
  nativeInitializer = false,
  topLevel = false,
} = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body><form id="form">
    <label>Pick <select name="choice" id="choice"><option value="apple">Apple</option>
      <optgroup label="Unavailable" disabled><option value="banana">Banana</option></optgroup>
      <option value="cherry">Cherry</option><option value="date">Date</option></select></label>
    <select id="native" data-starter-select="native"><option>Native</option></select>
    <select id="multiple" multiple><option>Multiple</option></select>
    <select id="sized" size="2"><option>Sized</option></select>
    <fieldset disabled><select id="disabled"><option>Disabled</option></select></fieldset>
    <button type="button" id="outside">Outside</button>
  </form></body></html>`,
    {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  if (!topLevel) dom.reconfigure({ windowTop: {} });
  const { window } = dom;
  window.structuredClone = structuredClone;
  window.Element.prototype.scrollIntoView = () => {};
  window.postMessage = () => {};
  const initializedSource = nativeInitializer
    ? source.replace("__STARTER_NATIVE_CONTEXT_MENU__", "true")
    : source;
  window.eval(
    browserFixture
      ? initializedSource.replace(
          'location.hostname !== "extension-ui.localhost"',
          '(location.hostname !== "127.0.0.1" || !location.pathname.startsWith("/fixture/ui/"))',
        )
      : initializedSource,
  );
  const port = { start() {}, close() {}, onmessage: null };
  window.dispatchEvent(
    new window.MessageEvent("message", {
      source: window.parent,
      data: { type: "starter:connect", version: 1 },
      ports: [port],
    }),
  );
  const control = window.document.querySelector("#choice");
  const pointer = (target) =>
    target.dispatchEvent(
      new window.MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  const key = (value, target = control) =>
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  const popup = () => window.document.querySelector("[data-starter-listbox]");
  const disconnect = () => {
    if (port.onmessage) port.onmessage({ data: { type: "closed" } });
    port.onmessage = null;
  };
  const close = () => {
    disconnect();
    window.close();
  };
  return {
    window,
    control,
    pointer,
    key,
    popup,
    disconnect,
    close,
    send: (value) => port.onmessage?.({ data: value }),
  };
}

test("native extension document menus stay suppressed after business disconnection while author menus keep working", () => {
  for (const url of [
    "extension-ui://localhost/main",
    "http://extension-ui.localhost/main",
    "https://extension-ui.localhost/main",
  ]) {
    const { window, disconnect, close } = selectFixture({ url });
    try {
      const button = window.document.querySelector("#outside");
      const contextMenu = () => {
        const event = new window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        button.dispatchEvent(event);
        return event;
      };
      assert.equal(contextMenu().defaultPrevented, true, url);
      let authorOpened = 0;
      button.addEventListener(
        "contextmenu",
        (event) => {
          assert.equal(event.defaultPrevented, false);
          event.preventDefault();
          authorOpened++;
        },
        { once: true },
      );
      assert.equal(contextMenu().defaultPrevented, true);
      assert.equal(authorOpened, 1);
      disconnect();
      assert.equal(contextMenu().defaultPrevented, true);
    } finally {
      close();
    }
  }
});

test("native all-frame initialization protects local descendant documents without granting them a host bridge", () => {
  assert.equal(source.split("__STARTER_NATIVE_CONTEXT_MENU__").length, 2);
  for (const url of ["about:blank", "about:srcdoc", "http://localhost:1420/"]) {
    for (const nativeInitializer of [false, true]) {
      const { window, close } = selectFixture({ url, nativeInitializer });
      try {
        assert.equal(window.starter, undefined);
        assert.equal(window.RTCPeerConnection, undefined);
        const event = new window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        window.document.querySelector("#outside").dispatchEvent(event);
        assert.equal(event.defaultPrevented, nativeInitializer, url);
        const input = window.document.createElement("textarea");
        window.document.body.append(input);
        const editing = new window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(editing);
        assert.equal(editing.defaultPrevented, false, url);
      } finally {
        close();
      }
    }
  }
});

test("native SDK initialization leaves top-level host menu handling to the application", () => {
  const { window, close } = selectFixture({
    url: "http://localhost:1420/",
    nativeInitializer: true,
    topLevel: true,
  });
  try {
    assert.equal(window.starter, undefined);
    const event = new window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.document.querySelector("#outside").dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  } finally {
    close();
  }
});

test("native extension editing and real text selections retain WebView clipboard menus without a new clipboard bridge", () => {
  const { window, close } = selectFixture();
  try {
    const { document } = window;
    const region = document.createElement("section");
    region.innerHTML = `<input id="text" value="Draft"><input id="readonly" readonly value="Copy">
      <input id="password" type="password"><textarea id="textarea">Draft</textarea>
      <div contenteditable="true"><span id="editable">Edit</span><span contenteditable="false" id="locked">Locked</span></div>
      <div contenteditable="plaintext-only" id="plain">Plain</div>
      <input id="disabled" disabled><input id="checkbox" type="checkbox">
      <p id="selection">Selectable text</p>`;
    document.body.append(region);
    const contextMenu = (id) => {
      const event = new window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      document.getElementById(id).dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (const id of [
      "text",
      "readonly",
      "password",
      "textarea",
      "editable",
      "plain",
    ])
      assert.equal(contextMenu(id), false, id);
    for (const id of ["locked", "disabled", "checkbox", "selection"])
      assert.equal(contextMenu(id), true, id);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("selection"));
    selection.addRange(range);
    assert.equal(contextMenu("selection"), false);
    assert.equal(contextMenu("outside"), true);
    selection.removeAllRanges();
    assert.equal(contextMenu("selection"), true);
    assert.equal("clipboard" in window.starter, false);
  } finally {
    close();
  }
});

test("browser extension fixtures keep their ordinary context menu behavior", () => {
  const { window, close } = selectFixture({
    url: "http://127.0.0.1/fixture/ui/main",
    browserFixture: true,
  });
  try {
    assert.equal(typeof window.starter, "object");
    const event = new window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.document.querySelector("#outside").dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  } finally {
    close();
  }
});

test("enhanced select retains its native node, form value and label while keyboard/click selection emits one real change", () => {
  const { window, control, pointer, key, popup, close } = selectFixture();
  let changes = 0,
    inputs = 0;
  control.addEventListener("change", () => changes++);
  control.addEventListener("input", () => inputs++);
  control.setAttribute("aria-controls", "author-control");
  pointer(control);
  assert.equal(window.document.querySelector("#choice"), control);
  assert.equal(popup().getAttribute("role"), "listbox");
  assert.equal(popup().getAttribute("aria-label"), "Pick");
  assert.equal(window.document.activeElement, control);
  key("ArrowDown"); // Skip the disabled optgroup.
  assert.equal(control.value, "apple");
  assert.equal(
    control.getAttribute("aria-activedescendant"),
    popup().querySelector("[data-active]").id,
  );
  key("Enter");
  assert.equal(control.value, "cherry");
  assert.equal(new window.FormData(control.form).get("choice"), "cherry");
  assert.equal(changes, 1);
  assert.equal(inputs, 1);
  assert.equal(popup(), null);
  assert.equal(control.getAttribute("aria-controls"), "author-control");
  pointer(control);
  key("End");
  key("Escape");
  assert.equal(control.value, "cherry");
  assert.equal(changes, 1);
  pointer(control);
  key("a");
  key("Enter");
  assert.equal(control.value, "apple");
  pointer(control);
  pointer(popup().querySelector('[data-starter-option="3"]'));
  assert.equal(control.value, "date");
  assert.equal(changes, 3);
  close();
});

test("enhanced select options ignore secondary and auxiliary pointer buttons", () => {
  const { window, control, pointer, popup, close } = selectFixture();
  try {
    let changes = 0;
    control.addEventListener("change", () => changes++);
    pointer(control);
    const option = popup().querySelector('[data-starter-option="3"]');
    for (const button of [1, 2]) {
      option.dispatchEvent(
        new window.MouseEvent("pointerdown", {
          button,
          bubbles: true,
          cancelable: true,
        }),
      );
      assert.equal(control.value, "apple");
      assert.equal(changes, 0);
      assert.ok(popup());
    }
    pointer(option);
    assert.equal(control.value, "date");
    assert.equal(changes, 1);
    assert.equal(popup(), null);
  } finally {
    close();
  }
});

test("select opt-outs, disabled fieldsets, reset and removed controls keep native semantics and clean popup resources", async () => {
  const { window, control, pointer, key, popup, disconnect, close } =
    selectFixture();
  for (const id of ["native", "multiple", "sized", "disabled"]) {
    pointer(window.document.getElementById(id));
    assert.equal(popup(), null);
  }
  pointer(control);
  key("End");
  key("Tab");
  assert.equal(control.value, "date");
  pointer(control);
  key("Home");
  control.value = "cherry"; // Property assignment need not emit an input event.
  key("Tab");
  assert.equal(control.value, "cherry");
  pointer(control);
  control.value = "date";
  key("ArrowUp");
  key("Enter");
  assert.equal(control.value, "cherry");
  pointer(control);
  control.form.reset();
  assert.equal(control.value, "apple");
  assert.equal(popup(), null);
  pointer(control);
  control.value = "cherry";
  control.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(
    popup().querySelector("[data-active]").dataset.starterOption,
    "2",
  );
  control.remove();
  await Promise.resolve();
  assert.equal(popup(), null);
  assert.equal(control.hasAttribute("aria-expanded"), false);
  const other = window.document.getElementById("native");
  other.removeAttribute("data-starter-select");
  pointer(other);
  assert.notEqual(popup(), null);
  disconnect();
  assert.equal(popup(), null);
  pointer(other);
  assert.equal(popup(), null);
  close();
});

test("explicit shadow styles retain native select semantics, share one picker and clean up idempotently", () => {
  const { window, control, pointer, key, popup, close } = selectFixture();
  try {
    const host = window.document.createElement("section");
    window.document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<label>Shadow choice <select><option value="one">One</option><option value="two">Two</option></select></label>';
    const select = root.querySelector("select");
    pointer(select);
    assert.equal(root.querySelector("[data-starter-listbox]"), null);
    assert.equal(root.querySelector("[data-starter-defaults]"), null);

    const cleanup = window.starter.applyStyles(root);
    const secondCleanup = window.starter.applyStyles(root);
    assert.equal(root.querySelectorAll("[data-starter-defaults]").length, 1);
    assert.match(
      root.querySelector("[data-starter-defaults]").textContent,
      /@layer starter-defaults/,
    );
    let changes = 0;
    select.addEventListener("change", () => changes++);
    pointer(select);
    const shadowPopup = () => root.querySelector("[data-starter-listbox]");
    assert.equal(shadowPopup().getAttribute("aria-label"), "Shadow choice");
    key("End", select);
    key("Enter", select);
    assert.equal(select.value, "two");
    assert.equal(changes, 1);
    pointer(select);
    pointer(control);
    assert.equal(shadowPopup(), null);
    assert.notEqual(popup(), null);
    pointer(select);
    assert.equal(popup(), null);
    assert.notEqual(shadowPopup(), null);
    cleanup();
    cleanup();
    assert.equal(root.querySelectorAll("[data-starter-defaults]").length, 1);
    assert.notEqual(shadowPopup(), null);
    secondCleanup();
    secondCleanup();
    assert.equal(root.querySelector("[data-starter-defaults]"), null);
    assert.equal(shadowPopup(), null);
    assert.equal(select.hasAttribute("aria-expanded"), false);
    pointer(select);
    assert.equal(shadowPopup(), null);
  } finally {
    close();
  }
});

test("one complete host stylesheet reaches current and future controls and registered shadow trees", () => {
  const { window, send, close } = selectFixture();
  try {
    const before = window.document.createElement("section");
    window.document.body.append(before);
    const shadow = before.attachShadow({ mode: "open" });
    const dispose = window.starter.applyStyles(shadow);
    const author = window.document.createElement("style");
    author.textContent = "button { background: rebeccapurple; }";
    window.document.head.append(author);
    send({
      type: "state",
      value: snapshot({ theme: { tokens: { "--retired-material": "red" } } }),
    });
    const documentStyle = window.document.querySelector(
      "[data-starter-defaults]",
    );
    const shadowStyle = shadow.querySelector("[data-starter-defaults]");
    assert.equal(documentStyle.textContent, sharedStyles);
    assert.equal(shadowStyle.textContent, sharedStyles);
    // 首帧未使用的少见控件以后插入时，已有的完整样式无需再做 DOM 检测或请求。
    const rare = window.document.createElement("meter");
    rare.value = 0.5;
    window.document.body.append(rare);
    assert.match(documentStyle.textContent, /meter/);
    const later = window.document.createElement("section");
    window.document.body.append(later);
    const laterRoot = later.attachShadow({ mode: "closed" });
    const disposeLater = window.starter.applyStyles(laterRoot);
    assert.equal(
      laterRoot.querySelector("[data-starter-defaults]").textContent,
      sharedStyles,
    );
    const updated = `${sharedStyles}\n@layer starter-defaults { output { border-style: dashed; } }`;
    send({ type: "state", value: snapshot({ theme: { styles: updated } }) });
    assert.equal(documentStyle.textContent, updated);
    assert.equal(shadowStyle.textContent, updated);
    assert.equal(
      laterRoot.querySelector("[data-starter-defaults]").textContent,
      updated,
    );
    assert.equal(
      window.document.documentElement.style.getPropertyValue(
        "--retired-material",
      ),
      "",
    );
    assert.equal(author.textContent, "button { background: rebeccapurple; }");
    dispose();
    disposeLater();
  } finally {
    close();
  }
});

test("shadow registration is local to this document and tracks host motion until surface closure", () => {
  const { window, send, disconnect, pointer, close } = selectFixture();
  const foreign = new JSDOM("<section></section>");
  try {
    assert.throws(
      () => window.starter.applyStyles(window.document.body),
      /Expected a ShadowRoot/,
    );
    const foreignRoot = foreign.window.document
      .querySelector("section")
      .attachShadow({ mode: "open" });
    assert.throws(
      () => window.starter.applyStyles(foreignRoot),
      /Expected a ShadowRoot/,
    );
    const host = window.document.createElement("section");
    window.document.body.append(host);
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML =
      "<select><option>One</option><option>Two</option></select>";
    const cleanup = window.starter.applyStyles(root);
    const style = root.querySelector("[data-starter-defaults]");
    send({
      type: "state",
      value: snapshot({
        theme: { mode: "dark", motion: "reduced", tokens: {} },
      }),
    });
    assert.match(
      style.textContent,
      /\n@layer starter-defaults \{ \*,\*::before,\*::after/,
    );
    send({
      type: "state",
      value: { theme: { mode: "light", motion: "full", tokens: {} } },
    });
    assert.doesNotMatch(
      style.textContent,
      /\n@layer starter-defaults \{ \*,\*::before,\*::after/,
    );
    pointer(root.querySelector("select"));
    assert.notEqual(root.querySelector("[data-starter-listbox]"), null);
    disconnect();
    assert.equal(root.querySelector("[data-starter-listbox]"), null);
    assert.equal(root.querySelector("[data-starter-defaults]"), null);
    assert.throws(
      () => window.starter.applyStyles(root),
      /Extension surface closed/,
    );
    cleanup();
    cleanup();
  } finally {
    close();
    foreign.window.close();
  }
});

test("inactive surfaces close document and shadow pickers without committing and pause CSS motion until resumed", () => {
  const { window, send, control, pointer, key, popup, close } = selectFixture();
  try {
    send({ type: "state", value: snapshot() });
    const host = window.document.createElement("section");
    window.document.body.append(host);
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      "<select><option>One</option><option>Two</option></select>";
    const cleanup = window.starter.applyStyles(shadow);
    const style = shadow.querySelector("[data-starter-defaults]");
    pointer(control);
    key("End");
    assert.notEqual(popup(), null);
    send({ type: "state", value: { active: false } });
    assert.equal(popup(), null);
    assert.equal(control.value, "apple");
    assert.equal(control.hasAttribute("aria-expanded"), false);
    assert.match(
      style.textContent,
      /\n@layer starter-defaults \{ \*,\*::before,\*::after \{ animation-play-state:paused/,
    );
    assert.equal(window.document.documentElement.dataset.motion, "full");
    pointer(control);
    pointer(shadow.querySelector("select"));
    assert.equal(popup(), null);
    assert.equal(shadow.querySelector("[data-starter-listbox]"), null);

    send({ type: "state", value: { active: true } });
    assert.doesNotMatch(
      style.textContent,
      /\n@layer starter-defaults \{ \*,\*::before,\*::after \{ animation-play-state:paused/,
    );
    pointer(shadow.querySelector("select"));
    assert.notEqual(shadow.querySelector("[data-starter-listbox]"), null);
    send({
      type: "state",
      value: {
        active: false,
        theme: { mode: "dark", motion: "reduced", tokens: {} },
      },
    });
    assert.equal(shadow.querySelector("[data-starter-listbox]"), null);
    assert.match(style.textContent, /animation-play-state:paused/);
    assert.match(style.textContent, /animation-duration:1ms/);
    assert.equal(window.document.documentElement.dataset.motion, "reduced");
    cleanup();
  } finally {
    close();
  }
});

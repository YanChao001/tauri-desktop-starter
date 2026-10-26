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
  const parent = {
    postMessage: (value) =>
      parentMessages.push(JSON.parse(JSON.stringify(value))),
  };
  const root = {
    dataset: {},
    style: { setProperty: (key, value) => tokens.set(key, value) },
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
    createElement: () => ({ dataset: {}, textContent: "" }),
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
    send,
    close,
    messages,
    parentMessages,
    frame: () => frames.splice(0).forEach((callback) => callback()),
    documentEvents,
    errors,
  };
}

test("resource and link SDK types expose typed receipts and reject unknown services, actions, paths and identities", () => {
  const filename = fileURLToPath(
    new URL("../sdk/service-types.fixture.ts", import.meta.url),
  ).replaceAll("\\", "/");
  const fixtureSource = `
    import type { ExtensionUiApi, ExtensionResourceRequest } from "./extension-ui";
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
      return { bytes, dataUrl, released, opened, legacy, wallpaper };
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

test("resources and links share the existing service channel without supplying native identity", async () => {
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
    (error) => error.code === "EXTENSION_UNAVAILABLE",
  );
  assert.equal(messages.length, 4);
  const rejected = pending.map((operation) =>
    assert.rejects(
      operation,
      (error) => error.code === "EXTENSION_UNAVAILABLE",
    ),
  );
  close();
  await Promise.all(rejected);
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
  assert.equal(events.size, 0);
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
  assert.equal(active.events.size, 0);
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
function snapshot(overrides = {}) {
  return {
    view: null,
    fields: {},
    checkpoint: null,
    busy: false,
    dirty: false,
    locale: "en",
    grantedPermissions: [],
    theme: {
      mode: "light",
      motion: "full",
      tokens: { "--host-font-size": "17px", "--primary": "blue" },
    },
    ...overrides,
  };
}

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
  let finish;
  document.startViewTransition = (update) => ({
    ready: Promise.resolve(update()),
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
  await new Promise(setImmediate);
  assert.equal(animations.length, 1);
  assert.deepEqual(Array.from(animations[0].frames.clipPath), [
    "circle(0px at -150px -30px)",
    "circle(1400px at -150px -30px)",
  ]);
  assert.equal(animations[0].options.duration, 520);
  assert.ok(animations[0].animation.currentTime >= 20);
  send({
    type: "state",
    value: snapshot({
      fields: { value: "new draft" },
      theme: { mode: "dark", motion: "full", tokens: {} },
    }),
  });
  assert.equal(observed.at(-1), "new draft");
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

function selectFixture() {
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
      url: "https://extension-ui.localhost/main",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  dom.reconfigure({ windowTop: {} });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = () => {};
  window.postMessage = () => {};
  window.eval(source);
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
  return { window, control, pointer, key, popup, disconnect, close };
}

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

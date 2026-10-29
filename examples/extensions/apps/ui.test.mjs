import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("./ui/main.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
function mount(t, view, run, options = {}) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const calls = [],
    animations = [],
    timers = new Map();
  let timerId = 0;
  dom.window.TextEncoder = TextEncoder;
  dom.window.setTimeout = (callback) => {
    const id = ++timerId;
    timers.set(id, callback);
    return id;
  };
  dom.window.clearTimeout = (id) => timers.delete(id);
  let notify,
    visibility,
    mediaChange,
    hidden = false,
    disconnected = false;
  const media = {
    matches: false,
    addEventListener: (_, listener) => {
      mediaChange = listener;
    },
    removeEventListener: () => {
      mediaChange = null;
    },
  };
  dom.window.matchMedia = () => media;
  Object.defineProperty(dom.window.document, "hidden", { get: () => hidden });
  dom.window.IntersectionObserver = class {
    constructor(listener) {
      visibility = listener;
    }
    observe() {
      visibility([{ isIntersecting: true }]);
    }
    disconnect() {
      disconnected = true;
    }
  };
  dom.window.Element.prototype.animate = function (frames, settings) {
    const animation = {
      node: this,
      frames,
      settings,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(animation);
    return animation;
  };
  let snapshot = {
    view,
    locale: "en",
    theme: { motion: options.motion ?? "full" },
    fields: Object.fromEntries(view.fields.map((f) => [f.id, f.value])),
    checkpoint: options.checkpoint ?? null,
    dirty: false,
    busy: false,
    active: options.active ?? true,
  };
  dom.window.starter = {
    onChange: (listener) => {
      notify = listener;
    },
    checkpoint: async (value, dirty) => {
      calls.push({ checkpoint: structuredClone(value), dirty });
      if (options.checkpointError) throw options.checkpointError;
    },
    run: async (id, fields) => {
      calls.push({ id, fields });
      const next = await (run ? run(id, fields) : view);
      snapshot = {
        ...snapshot,
        view: next,
        fields: Object.fromEntries(
          next.fields.map((field) => [field.id, field.value]),
        ),
      };
      return next;
    },
    saveArtifact: async () => {
      calls.push({ saveArtifact: true });
      return options.saved ?? false;
    },
    notify: async (message, settings) => {
      calls.push({ notification: message, ...settings });
    },
  };
  dom.window.eval(script);
  notify(snapshot);
  return {
    window: dom.window,
    document: dom.window.document,
    calls,
    animations,
    timers,
    tick() {
      const pending = [...timers];
      timers.clear();
      pending.forEach(([, callback]) => callback());
    },
    publish(patch) {
      snapshot = { ...snapshot, ...patch };
      notify(snapshot);
    },
    visibility(value) {
      visibility([{ isIntersecting: value }]);
    },
    reduced(value) {
      media.matches = value;
      mediaChange?.();
    },
    hidden(value) {
      hidden = value;
      dom.window.document.dispatchEvent(
        new dom.window.Event("visibilitychange"),
      );
    },
    disconnected: () => disconnected,
  };
}

const studioView = () => ({
  display: "Studio",
  description: "",
  tabs: [],
  fields: [],
  groups: [],
  blocks: [],
});
const localStudio = (t, options = {}, run) =>
  mount(t, studioView(), run, options);
const click = (ui, id) => ui.document.getElementById(id).click();
const edit = (ui, id, value, type = "input") => {
  const node = ui.document.getElementById(id);
  node.value = value;
  node.dispatchEvent(new ui.window.Event(type, { bubbles: true }));
};
const checkpoint = (ui) =>
  ui.calls.findLast((call) => call.checkpoint)?.checkpoint;
const rowsOf = (ui, id) =>
  [...ui.document.querySelectorAll(`#${id} tbody tr`)].map((row) =>
    [...row.cells].map((cell) => cell.textContent),
  );
function loadRows(ui, rows) {
  click(ui, "studio-tab-lens");
  click(ui, "lens-edit");
  edit(ui, "lens-source", JSON.stringify(rows));
  click(ui, "lens-apply");
}

test("创意场景即时切换且复用节点，主导航支持方向键且无需运行 Wasm", (t) => {
  const ui = localStudio(t);
  const navigation = [
    ...ui.document.querySelectorAll("#studio-nav [role=tab]"),
  ];
  const canvasNode = ui.document.querySelector("[data-node=n2]");
  assert.deepEqual(
    navigation.map((node) => node.dataset.scene),
    ["canvas", "lens", "flow"],
  );
  assert.equal(ui.document.getElementById("scene-canvas").hidden, false);
  navigation[0].focus();
  navigation[0].dispatchEvent(
    new ui.window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    }),
  );
  assert.equal(ui.document.activeElement, navigation[1]);
  assert.equal(navigation[1].getAttribute("aria-selected"), "true");
  click(ui, "studio-tab-flow");
  click(ui, "studio-tab-canvas");
  navigation[0].dispatchEvent(
    new ui.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
  );
  assert.deepEqual(
    [...ui.document.querySelectorAll("#studio-nav [role=tab]")],
    navigation,
  );
  assert.equal(ui.document.querySelector("[data-node=n2]"), canvasNode);
  assert.equal(ui.calls.filter((call) => call.id).length, 0);
  assert.equal(ui.document.getElementById("scene-canvas").hidden, false);
});

test("创意画布支持添加移除、连接切换、键盘微调和逐步撤销", (t) => {
  const ui = localStudio(t);
  click(ui, "canvas-add");
  assert.equal(ui.document.querySelectorAll(".canvas-node").length, 6);
  assert.equal(ui.document.activeElement.id, "node-title");
  const title = '<img src=x onerror="alert(1)">';
  edit(ui, "node-title", title);
  assert.equal(
    ui.document.querySelector("[data-node=n6] .node-title").textContent,
    title,
  );
  assert.equal(ui.document.querySelector("img"), null);
  const node = ui.document.querySelector("[data-node=n6]");
  const previousX = Number.parseFloat(node.style.left);
  node.focus();
  node.dispatchEvent(
    new ui.window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(Number.parseFloat(node.style.left), previousX + 0.5);
  click(ui, "canvas-undo");
  assert.equal(
    Number.parseFloat(ui.document.querySelector("[data-node=n6]").style.left),
    previousX,
  );
  edit(ui, "node-target", "n1", "change");
  click(ui, "canvas-connect");
  assert.equal(ui.document.getElementById("edge-count").textContent, "6");
  assert.ok(
    checkpoint(ui).studio.edges.some(
      ([from, to]) => from === "n6" && to === "n1",
    ),
  );
  click(ui, "canvas-connect");
  assert.equal(ui.document.getElementById("edge-count").textContent, "5");
  click(ui, "canvas-remove");
  assert.equal(ui.document.querySelectorAll(".canvas-node").length, 5);
  click(ui, "canvas-undo");
  assert.equal(ui.document.querySelectorAll(".canvas-node").length, 6);
  assert.equal(
    ui.document.querySelector("[data-node=n6] .node-title").textContent,
    title,
  );
});

test("画布排列与撤销平滑过渡，键盘位置已登记且减少动效立即取消过渡", (t) => {
  const ui = localStudio(t);
  ui.document.getElementById("node-stage").getBoundingClientRect = () => ({
    width: 900,
    height: 440,
  });
  click(ui, "canvas-arrange");
  const arranging = ui.animations.filter((animation) =>
    animation.node.classList.contains("canvas-node"),
  );
  assert.equal(arranging.length, 5);
  assert.ok(
    arranging.every((animation) =>
      animation.frames[0].transform.includes("translate("),
    ),
  );
  const selected = ui.document.querySelector("[data-node=n2]");
  const position = Number.parseFloat(selected.style.left);
  selected.focus();
  selected.dispatchEvent(
    new ui.window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    }),
  );
  assert.equal(Number.parseFloat(selected.style.left), position + 2);
  assert.equal(
    checkpoint(ui).studio.nodes.find((node) => node.id === "n2").x,
    position + 2,
  );
  ui.reduced(true);
  assert.ok(arranging.every((animation) => animation.cancelled));
  const count = ui.animations.length;
  click(ui, "canvas-undo");
  assert.equal(ui.animations.length, count);
  assert.equal(
    Number.parseFloat(ui.document.querySelector("[data-node=n2]").style.left),
    position,
  );
  ui.reduced(false);
  click(ui, "canvas-arrange");
  const pending = ui.animations.slice(count);
  assert.equal(pending.length, 5);
  ui.visibility(false);
  assert.ok(pending.every((animation) => animation.cancelled));
});

test("检查点重建恢复画布、数据与场景，非法未来草稿保持原样", (t) => {
  const ui = localStudio(t);
  click(ui, "canvas-add");
  edit(ui, "node-title", "Retained project");
  const rows = [
    { label: "Alpha", category: "Research", value: 12 },
    { label: "Beta", category: "Build", value: 30 },
  ];
  loadRows(ui, rows);
  click(ui, "chart-line");
  click(ui, "studio-tab-flow");
  edit(ui, "flow-min", "15");
  const saved = checkpoint(ui);
  const restored = localStudio(t, { checkpoint: saved });
  assert.equal(restored.document.getElementById("scene-flow").hidden, false);
  assert.equal(restored.document.getElementById("flow-min").value, "15");
  assert.equal(
    restored.document.querySelector("[data-node=n6] .node-title").textContent,
    "Retained project",
  );
  assert.equal(restored.document.getElementById("lens-count").textContent, "2");
  assert.equal(
    restored.document.getElementById("lens-total").textContent,
    "42",
  );
  assert.equal(
    restored.document.querySelectorAll("#lens-chart circle").length,
    2,
  );
  const future = structuredClone(saved);
  future.studio.schema = 99;
  const rejected = localStudio(t, { checkpoint: future });
  assert.match(
    rejected.document.getElementById("studio-error").textContent,
    /checkpoint.*retained/i,
  );
  assert.equal(
    rejected.calls.some((call) => Object.hasOwn(call, "checkpoint")),
    false,
  );
  assert.equal(rejected.document.getElementById("canvas-add").disabled, true);
  assert.equal(rejected.document.getElementById("node-title").disabled, true);
  click(rejected, "canvas-add");
  click(rejected, "studio-tab-lens");
  click(rejected, "studio-tab-flow");
  assert.equal(rejected.document.getElementById("flow-run").disabled, true);
  assert.equal(
    rejected.calls.some((call) => Object.hasOwn(call, "checkpoint")),
    false,
  );
  assert.equal(
    rejected.calls.some((call) => call.id),
    false,
  );
  assert.equal(future.studio.schema, 99);
});

test("数据源未完成 JSON 草稿跨场景与检查点重建保留，取消编辑不改变数据", (t) => {
  const ui = localStudio(t);
  click(ui, "studio-tab-lens");
  click(ui, "lens-edit");
  const source = ui.document.getElementById("lens-source"),
    chart = ui.document.querySelector("#lens-chart .bar-fill"),
    canvasNode = ui.document.querySelector("[data-node=n2]");
  const draft = '[{"label":"Unfinished source",';
  edit(ui, "lens-source", draft);
  assert.equal(ui.calls.at(-1).dirty, true);
  assert.equal(checkpoint(ui).studio.sourceDraft, draft);
  assert.equal(checkpoint(ui).studio.editorOpen, true);
  assert.equal(ui.document.querySelector("#lens-chart .bar-fill"), chart);
  assert.equal(ui.document.querySelector("[data-node=n2]"), canvasNode);
  source.setSelectionRange(2, 6);
  source.scrollTop = 24;
  click(ui, "lens-edit");
  assert.equal(source.value, draft);
  assert.equal(source.selectionStart, 2);
  assert.equal(source.selectionEnd, 6);
  assert.equal(source.scrollTop, 24);
  click(ui, "studio-tab-canvas");
  click(ui, "studio-tab-lens");
  assert.equal(ui.document.getElementById("lens-source").value, draft);
  const restored = localStudio(t, { checkpoint: checkpoint(ui) });
  assert.equal(restored.document.getElementById("data-editor").hidden, false);
  assert.equal(restored.document.getElementById("lens-source").value, draft);
  assert.equal(
    restored.document.getElementById("lens-edit").getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(
    restored.document.getElementById("lens-total").textContent,
    "526",
  );
  click(restored, "lens-cancel");
  assert.equal(checkpoint(restored).studio.sourceDraft, null);
  assert.equal(checkpoint(restored).studio.editorOpen, false);
  assert.equal(restored.document.getElementById("data-editor").hidden, true);
  assert.equal(restored.document.activeElement.id, "lens-edit");
  assert.equal(
    restored.document.getElementById("lens-edit").getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(restored.document.getElementById("lens-count").textContent, "8");
  click(restored, "lens-edit");
  assert.equal(
    JSON.parse(restored.document.getElementById("lens-source").value).length,
    8,
  );
});

test("数据源应用成功后清除编辑草稿，失败校验保留原文并关联错误", (t) => {
  const ui = localStudio(t);
  click(ui, "studio-tab-lens");
  click(ui, "lens-edit");
  edit(ui, "lens-source", "{");
  click(ui, "lens-apply");
  const source = ui.document.getElementById("lens-source");
  assert.equal(source.value, "{");
  assert.equal(checkpoint(ui).studio.sourceDraft, "{");
  assert.equal(source.getAttribute("aria-invalid"), "true");
  assert.equal(source.getAttribute("aria-describedby"), "lens-error");
  const rows = [{ label: "Applied", category: "Research", value: 17 }];
  edit(ui, "lens-source", JSON.stringify(rows));
  assert.equal(source.hasAttribute("aria-invalid"), false);
  click(ui, "lens-apply");
  assert.deepEqual(checkpoint(ui).studio.rows, rows);
  assert.equal(checkpoint(ui).studio.sourceDraft, null);
  assert.equal(checkpoint(ui).studio.editorOpen, false);
  assert.equal(ui.document.getElementById("data-editor").hidden, true);
  assert.equal(ui.document.activeElement.id, "lens-edit");
  click(ui, "lens-edit");
  assert.deepEqual(JSON.parse(source.value), rows);
  edit(ui, "lens-source", "{");
  click(ui, "lens-sample");
  assert.equal(ui.document.getElementById("data-editor").hidden, true);
  assert.equal(ui.document.getElementById("lens-error").textContent, "");
  assert.equal(checkpoint(ui).studio.sourceDraft, null);
});

test("旧检查点缺省编辑元数据可读，损坏编辑草稿保留原检查点且拒绝覆盖", (t) => {
  const ui = localStudio(t);
  click(ui, "studio-tab-lens");
  const saved = checkpoint(ui);
  delete saved.studio.sourceDraft;
  delete saved.studio.editorOpen;
  const restored = localStudio(t, { checkpoint: saved });
  assert.equal(
    restored.document.getElementById("studio-error").textContent,
    "",
  );
  assert.equal(restored.document.getElementById("data-editor").hidden, true);
  click(restored, "lens-edit");
  assert.equal(
    JSON.parse(restored.document.getElementById("lens-source").value).length,
    saved.studio.rows.length,
  );
  for (const patch of [
    { sourceDraft: { invalid: true } },
    { sourceDraft: "a".repeat(48001) },
    { editorOpen: "true" },
  ]) {
    const invalid = structuredClone(saved);
    Object.assign(invalid.studio, patch);
    const rejected = localStudio(t, { checkpoint: invalid });
    assert.match(
      rejected.document.getElementById("studio-error").textContent,
      /checkpoint.*retained/i,
    );
    assert.equal(rejected.document.getElementById("lens-edit").disabled, true);
    assert.equal(
      rejected.calls.some((call) => call.checkpoint),
      false,
    );
  }
});

test("数据源 UTF-8 超限显式截取并登记，登记失败仍保留页面输入", async (t) => {
  const ui = localStudio(t);
  click(ui, "studio-tab-lens");
  click(ui, "lens-edit");
  edit(ui, "lens-source", "数据🌌".repeat(5000));
  const retained = ui.document.getElementById("lens-source").value;
  assert.equal(new TextEncoder().encode(retained).length, 48000);
  assert.equal(retained, "数据🌌".repeat(4800));
  assert.equal(checkpoint(ui).studio.sourceDraft, retained);
  assert.equal(ui.calls.at(-1).dirty, true);
  assert.match(
    ui.document.getElementById("lens-error").textContent,
    /48000 bytes/,
  );
  const restored = localStudio(t, { checkpoint: checkpoint(ui) });
  assert.equal(restored.document.getElementById("lens-source").value, retained);

  const unavailable = localStudio(t, {
    checkpointError: new Error("Bridge unavailable"),
  });
  click(unavailable, "studio-tab-lens");
  click(unavailable, "lens-edit");
  edit(unavailable, "lens-source", '[{"label":"Keep this unfinished draft",');
  await new Promise(setImmediate);
  assert.equal(
    unavailable.document.getElementById("lens-source").value,
    '[{"label":"Keep this unfinished draft",',
  );
  assert.match(
    unavailable.document.getElementById("studio-error").textContent,
    /still on this page/,
  );
});

test("导出数据成果保持未应用 JSON 原稿与编辑器状态", async (t) => {
  const exported = {
    ...studioView(),
    artifacts: [{ name: "lens.csv", media_type: "text/csv", content: "" }],
  };
  const ui = localStudio(t, {}, async () => exported);
  click(ui, "studio-tab-lens");
  click(ui, "lens-edit");
  const draft = '[{"label":"Not applied",';
  edit(ui, "lens-source", draft);
  click(ui, "lens-export");
  await new Promise(setImmediate);
  const saved = checkpoint(ui);
  assert.equal(saved.studio.sourceDraft, draft);
  assert.equal(saved.studio.editorOpen, true);
  const payload = JSON.parse(
    ui.calls.find((call) => call.id === "workspace-export").fields.workspace,
  );
  assert.equal(payload.rows.length, saved.studio.rows.length);
  assert.equal(payload.rows[0][0], saved.studio.rows[0].label);
  const restored = localStudio(t, { checkpoint: saved });
  assert.equal(restored.document.getElementById("lens-source").value, draft);
  assert.equal(restored.document.getElementById("data-editor").hidden, false);
});

test("数据透镜校验 JSON 边界，图表与统计按照筛选结果计算", (t) => {
  const ui = localStudio(t);
  const rows = [
    { label: "Alpha", category: "A", value: 10 },
    { label: "Beta", category: "A", value: 30 },
    { label: "Gamma", category: "B", value: 60 },
  ];
  loadRows(ui, rows);
  assert.equal(ui.document.getElementById("lens-total").textContent, "100");
  assert.equal(ui.document.getElementById("lens-average").textContent, "33.3");
  assert.deepEqual(rowsOf(ui, "lens-table"), [
    ["Alpha", "A", "10"],
    ["Beta", "A", "30"],
    ["Gamma", "B", "60"],
  ]);
  assert.equal(ui.document.querySelectorAll("#lens-chart .bar-fill").length, 3);
  edit(ui, "lens-category", "A", "change");
  edit(ui, "lens-min", "20");
  assert.equal(ui.document.getElementById("lens-count").textContent, "1");
  assert.equal(ui.document.getElementById("lens-total").textContent, "30");
  assert.match(
    ui.document.getElementById("lens-chart").getAttribute("aria-label"),
    /1 rows, total 30/,
  );
  click(ui, "chart-line");
  assert.equal(ui.document.querySelectorAll("#lens-chart circle").length, 1);
  assert.equal(
    ui.document.querySelector("#lens-chart circle title").textContent,
    "Beta: 30",
  );
  const saved = checkpoint(ui);
  click(ui, "lens-edit");
  for (const invalid of [
    "{",
    JSON.stringify([{ label: "", category: "A", value: 1 }]),
    JSON.stringify([{ label: "A", category: "A", value: "1" }]),
    JSON.stringify([{ label: "A", category: "A", value: 1000001 }]),
    JSON.stringify(Array.from({ length: 121 }, () => rows[0])),
  ]) {
    edit(ui, "lens-source", invalid);
    click(ui, "lens-apply");
    assert.match(
      ui.document.getElementById("lens-error").textContent,
      /JSON array/,
    );
    assert.deepEqual(checkpoint(ui).studio.rows, saved.studio.rows);
    assert.equal(ui.document.getElementById("lens-total").textContent, "30");
  }
});

test("流程执行真实过滤、分类求和或平均与降序排序，减少动效即时完成", (t) => {
  const ui = localStudio(t, { motion: "reduced" });
  loadRows(ui, [
    { label: "a", category: "A", value: 10 },
    { label: "b", category: "A", value: 20 },
    { label: "c", category: "B", value: 40 },
    { label: "d", category: "B", value: 5 },
  ]);
  click(ui, "lens-send");
  edit(ui, "flow-min", "10");
  click(ui, "flow-run");
  assert.deepEqual(rowsOf(ui, "flow-table"), [
    ["B", "B", "40"],
    ["A", "A", "30"],
  ]);
  assert.equal(ui.document.getElementById("flow-count").textContent, "4 / 2");
  assert.equal(
    ui.document.querySelectorAll('[data-step][data-state="done"]').length,
    4,
  );
  assert.equal(ui.timers.size, 0);
  edit(ui, "flow-group", "average", "change");
  click(ui, "flow-run");
  assert.deepEqual(rowsOf(ui, "flow-table"), [
    ["B", "B", "40"],
    ["A", "A", "15"],
  ]);
  edit(ui, "flow-group", "none", "change");
  click(ui, "flow-run");
  assert.deepEqual(rowsOf(ui, "flow-table"), [
    ["c", "B", "40"],
    ["b", "A", "20"],
    ["a", "A", "10"],
  ]);
  edit(ui, "flow-min", "100");
  click(ui, "flow-run");
  assert.equal(rowsOf(ui, "flow-table").length, 0);
  assert.equal(ui.document.getElementById("flow-export").disabled, true);
});

test("数据透镜送入流程传递当前分类与最低值，后续探索不悄悄改变已接入筛选", (t) => {
  const ui = localStudio(t, { motion: "reduced" });
  loadRows(ui, [
    { label: "a", category: "A", value: 10 },
    { label: "b", category: "A", value: 20 },
    { label: "c", category: "A", value: 30 },
    { label: "d", category: "B", value: 100 },
  ]);
  edit(ui, "lens-category", "A", "change");
  edit(ui, "lens-min", "20");
  assert.equal(ui.document.getElementById("lens-count").textContent, "2");
  click(ui, "lens-send");
  edit(ui, "flow-min", "0");
  click(ui, "flow-run");
  assert.equal(ui.document.getElementById("flow-count").textContent, "2 / 1");
  assert.deepEqual(rowsOf(ui, "flow-table"), [["A", "A", "50"]]);
  click(ui, "studio-tab-lens");
  edit(ui, "lens-category", "B", "change");
  edit(ui, "lens-min", "0");
  click(ui, "studio-tab-flow");
  click(ui, "flow-run");
  assert.deepEqual(rowsOf(ui, "flow-table"), [["A", "A", "50"]]);
  click(ui, "studio-tab-lens");
  click(ui, "lens-send");
  click(ui, "flow-run");
  assert.equal(ui.document.getElementById("flow-count").textContent, "1 / 1");
  assert.deepEqual(rowsOf(ui, "flow-table"), [["B", "B", "100"]]);
  const restored = localStudio(t, {
    motion: "reduced",
    checkpoint: checkpoint(ui),
  });
  click(restored, "flow-run");
  assert.deepEqual(rowsOf(restored, "flow-table"), [["B", "B", "100"]]);
});

test("流程切页、隐藏、失活或卸载后取消定时器，减少动效与离屏停止持续动画", (t) => {
  const ui = localStudio(t);
  const start = () => {
    click(ui, "studio-tab-flow");
    click(ui, "flow-run");
    assert.equal(ui.timers.size, 1);
  };
  start();
  click(ui, "studio-tab-lens");
  assert.equal(ui.timers.size, 0);
  ui.tick();
  assert.equal(rowsOf(ui, "flow-table").length, 0);
  start();
  ui.hidden(true);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.document.querySelector("main").dataset.playing, "false");
  ui.hidden(false);
  start();
  ui.publish({ active: false });
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.document.querySelector("main").dataset.playing, "false");
  ui.publish({ active: true });
  click(ui, "studio-tab-canvas");
  ui.reduced(true);
  assert.equal(ui.document.querySelector("main").dataset.playing, "false");
  assert.equal(
    ui.animations.findLast((animation) => animation.node.id === "scene-canvas")
      .cancelled,
    true,
  );
  ui.reduced(false);
  start();
  ui.visibility(false);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.document.querySelector("main").dataset.playing, "false");
  ui.visibility(true);
  start();
  ui.reduced(true);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.document.getElementById("flow-count").textContent, "8 / 3");
  ui.reduced(false);
  start();
  ui.window.dispatchEvent(new ui.window.Event("pagehide"));
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.disconnected(), true);
});

test("导出执行期间锁定内容防止晚到结果覆盖，失败后恢复编辑与原草稿", async (t) => {
  let rejectExport;
  const ui = localStudio(t, {}, async () => {
    return new Promise((_, reject) => {
      rejectExport = reject;
    });
  });
  click(ui, "canvas-add");
  edit(ui, "node-title", "Keep after failed export");
  click(ui, "canvas-export");
  await new Promise(setImmediate);
  assert.equal(ui.document.getElementById("canvas-add").disabled, true);
  assert.equal(ui.document.getElementById("node-title").disabled, true);
  assert.equal(ui.document.getElementById("canvas-export").disabled, true);
  rejectExport(new Error("Transport unavailable"));
  await new Promise(setImmediate);
  assert.equal(ui.document.getElementById("canvas-add").disabled, false);
  assert.equal(ui.document.getElementById("node-title").disabled, false);
  assert.equal(
    checkpoint(ui).studio.nodes[5].title,
    "Keep after failed export",
  );
  assert.match(
    ui.document.getElementById("studio-error").textContent,
    /retained/,
  );
  assert.equal(ui.calls.filter((call) => call.tone === "success").length, 0);
});

test("导出取消保留完整检查点且没有成功通知，保存后才提示成功", async (t) => {
  const exported = {
    ...studioView(),
    artifacts: [
      { name: "canvas.json", media_type: "application/json", content: "{}" },
    ],
  };
  for (const saved of [false, true]) {
    const ui = localStudio(t, { saved }, async () => exported);
    click(ui, "canvas-add");
    edit(ui, "node-title", "Export this canvas");
    click(ui, "canvas-export");
    await new Promise(setImmediate);
    assert.deepEqual(
      ui.calls.filter((call) => call.id).map((call) => call.id),
      ["workspace-export"],
    );
    const payload = JSON.parse(
      ui.calls.find((call) => call.id === "workspace-export").fields.workspace,
    );
    assert.equal(payload.rows.length, 6);
    assert.equal(payload.rows[5][1], "Export this canvas");
    assert.equal(checkpoint(ui).studio.nodes.length, 6);
    assert.equal(
      ui.calls.some((call) => call.checkpoint === null),
      false,
    );
    assert.equal(
      ui.calls.filter((call) => call.tone === "success").length,
      Number(saved),
    );
    assert.equal(ui.calls.filter((call) => call.saveArtifact).length, 1);
  }
});

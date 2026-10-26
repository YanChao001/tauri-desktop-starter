import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("./ui/main.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const tabs = ["text", "data", "todo", "connections"].map((id) => ({
  id: `tab-${id}`,
  label: id,
  active: id === "text",
}));
const action = (id, label) => ({ id, label, disabled: false, primary: false });
const field = (id, kind, value = "") => ({ id, label: id, kind, value });

function mount(t, view, run) {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const calls = [];
  let notify;
  dom.window.starter = {
    onChange: (listener) => {
      notify = listener;
    },
    checkpoint: async (value) => {
      calls.push({ checkpoint: value });
    },
    run: async (id, fields) => {
      calls.push({ id, fields });
      return run ? run(id, fields) : view;
    },
    saveArtifact: async () => false,
  };
  dom.window.eval(script);
  notify({
    view,
    locale: "en",
    fields: Object.fromEntries(view.fields.map((f) => [f.id, f.value])),
    checkpoint: null,
    dirty: false,
    busy: false,
  });
  return { window: dom.window, document: dom.window.document, calls };
}

test("自包含 HTML 脚本可解析，四个页签支持方向键与首尾导航", (t) => {
  new Script(script);
  const { window, document } = mount(t, {
    display: "Text tools",
    description: "",
    tabs,
    fields: [],
    groups: [],
    blocks: [],
  });
  const buttons = [...document.querySelectorAll("[role=tab]")];
  assert.equal(buttons.length, 4);
  buttons[0].focus();
  buttons[0].dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "End", bubbles: true }),
  );
  assert.equal(document.activeElement, buttons[3]);
  buttons[3].dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
  );
  assert.equal(document.activeElement, buttons[0]);
});

test("待办直接显示逐行操作，外部任务文本不会变成 HTML", async (t) => {
  const title = '<img src=x onerror="alert(1)">';
  const view = {
    display: "Tasks",
    description: "",
    tabs: tabs.map((tab) => ({ ...tab, active: tab.id === "tab-todo" })),
    fields: [field("todo", "text"), field("due", "date")],
    groups: [
      {
        actions: [
          action("todo-add", "Add & save"),
          action("todo-toggle-0", `Complete: ${title}`),
          action("todo-remove-0", `Remove: ${title}`),
        ],
      },
    ],
    blocks: [
      {
        kind: "table",
        columns: ["Task", "Due", "Status"],
        rows: [[title, "", "Pending"]],
      },
    ],
  };
  const { document, calls } = mount(t, view);
  assert.equal(document.querySelectorAll(".task-row").length, 1);
  assert.equal(document.querySelector(".task-row p").textContent, title);
  assert.equal(document.querySelector("img"), null);
  assert.equal(
    document.querySelectorAll('#actions [data-action="todo-toggle-0"]').length,
    0,
  );
  document.querySelector('.task-row [data-action="todo-toggle-0"]').click();
  await new Promise(setImmediate);
  assert.equal(calls.find((call) => call.id)?.id, "todo-toggle-0");
});

test("处理失败保留输入和上次结果，不清除草稿检查点", async (t) => {
  const view = {
    display: "Text tools",
    description: "",
    tabs,
    fields: [field("text", "textarea", "Original")],
    groups: [{ actions: [action("analyze", "Apply")] }],
    blocks: [{ kind: "markdown", text: "### Result\n\n    Last result" }],
  };
  const { window, document, calls } = mount(t, view, async () => {
    throw new Error("Host unavailable");
  });
  const input = document.querySelector("textarea");
  input.value = "Keep this draft";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  document.querySelector('[data-action="analyze"]').click();
  await new Promise(setImmediate);
  assert.equal(document.querySelector("textarea").value, "Keep this draft");
  assert.match(document.querySelector("#results").textContent, /Last result/);
  assert.match(document.querySelector("#error").textContent, /did not finish/);
  assert.equal(
    calls.some((call) => call.checkpoint === null),
    false,
  );
});

// Headless HTML/SDK regression only. Host transport is a browser fixture;
// this does not claim native IPC, Wasm, dialogs or installed-app coverage.
// Run: node e2e/extensions/workbench-studio.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { build, preview } from "vite";
import tailwind from "@tailwindcss/vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cache = join(root, ".cache");
const output = join(root, "artifacts/browser/workbench-studio");
await Promise.all([
  mkdir(cache, { recursive: true }),
  mkdir(output, { recursive: true }),
]);
const temporary = await mkdtemp(join(cache, "workbench-studio-"));
const [html, sdk] = await Promise.all([
  readFile(join(root, "examples/extensions/apps/ui/main.html"), "utf8"),
  readFile(join(root, "sdk/extension-ui.js"), "utf8"),
]);
// The fixture uses srcdoc rather than the packaged extension-ui protocol.
const fixtureSdk = sdk.replace(
  /location\.protocol !== "extension-ui:" &&\s*location\.hostname !== "extension-ui\.localhost"/,
  "false",
);
assert.notEqual(fixtureSdk, sdk);
const embedded = html.replace(
  "<head>",
  `<head><script>${fixtureSdk.replaceAll("</script", "<\\/script")}</script>`,
);
let browser, server;
const report = {
  environment: "headless Chromium, real HTML and SDK, fixture transport",
  profiles: [],
};
try {
  await Promise.all([
    writeFile(
      join(temporary, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="./fixture.css"></head><body></body></html>',
    ),
    writeFile(
      join(temporary, "fixture.css"),
      `@import ${JSON.stringify(join(root, "src/index.css").replaceAll("\\", "/"))};\nhtml,body { margin:0; width:100%; height:100%; overflow:hidden; } iframe { display:block; border:0; width:100%; height:100%; }`,
    ),
  ]);
  await build({
    configFile: false,
    root: temporary,
    logLevel: "warn",
    plugins: [tailwind()],
    build: { outDir: join(temporary, "dist"), emptyOutDir: false },
  });
  server = await preview({
    configFile: false,
    root: temporary,
    logLevel: "warn",
    preview: { host: "127.0.0.1", port: 0 },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  browser = await chromium.launch({ headless: true });
  for (const profile of [
    {
      name: "wide-light",
      width: 1280,
      height: 900,
      mode: "light",
      locale: "zh-CN",
    },
    { name: "wide-dark", width: 1280, height: 900, mode: "dark", locale: "en" },
    {
      name: "minimum-light",
      width: 880,
      height: 600,
      mode: "light",
      locale: "zh-CN",
    },
    {
      name: "narrow-dark",
      width: 520,
      height: 900,
      mode: "dark",
      locale: "en",
    },
  ]) {
    const page = await browser.newPage({
      viewport: { width: profile.width, height: profile.height },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(
      ({ embedded, profile }) => {
        const root = document.documentElement;
        root.classList.toggle("dark", profile.mode === "dark");
        root.classList.toggle("light", profile.mode !== "dark");
        root.dataset.accent = "indigo";
        const style = getComputedStyle(root);
        const tokens = Object.fromEntries(
          Array.from(style)
            .filter((name) => name.startsWith("--"))
            .map((name) => [name, style.getPropertyValue(name).trim()]),
        );
        tokens["--host-font-family"] =
          style.getPropertyValue("--app-font-sans");
        tokens["--host-font-size"] = "16px";
        const tabs = ["studio", "text", "data", "todo", "connections"].map(
          (id) => ({ id: `tab-${id}`, label: id, active: id === "studio" }),
        );
        const initialView = {
          display: "Studio",
          description: "",
          tabs,
          fields: [],
          groups: [],
          blocks: [],
        };
        const tools = {
          text: {
            display: "Text tools",
            description: "Edit text and apply a conversion.",
            fields: [
              {
                id: "text-mode",
                label: "Conversion",
                kind: "select",
                value: "compact-json",
                options: [{ label: "Compact JSON", value: "compact-json" }],
              },
              {
                id: "text",
                label: "Text",
                kind: "textarea",
                value: "A retained tool draft",
              },
            ],
            action: { id: "analyze", label: "Apply text" },
            blocks: [
              { kind: "markdown", text: "Your result will appear here." },
            ],
          },
          data: {
            display: "CSV / JSON",
            description: "Preview structured data.",
            fields: [
              {
                id: "data-source",
                label: "Source",
                kind: "textarea",
                value: "label,category,value\nDraft,Build,42",
              },
            ],
            action: { id: "data-preview", label: "Preview data" },
            blocks: [
              { kind: "markdown", text: "Load CSV or JSON to preview rows." },
            ],
          },
          todo: {
            display: "Todo",
            description: "Keep a local checklist.",
            fields: [
              { id: "todo-title", label: "New task", kind: "text", value: "" },
            ],
            action: { id: "todo-add", label: "Add task" },
            blocks: [{ kind: "markdown", text: "Your checklist is empty." }],
          },
          connections: {
            display: "Files and network",
            description: "Receive a local file or an HTTPS response.",
            fields: [
              {
                id: "network-url",
                label: "HTTPS URL",
                kind: "text",
                value: "https://example.com/data.json",
              },
            ],
            action: { id: "network-fetch", label: "Receive response" },
            blocks: [
              { kind: "markdown", text: "Received content appears here." },
            ],
          },
        };
        const drafts = new Map();
        const toolView = (active) => {
          const tool = tools[active.slice(4)];
          return {
            ...initialView,
            tabs: tabs.map((tab) => ({ ...tab, active: tab.id === active })),
            ...(tool
              ? {
                  display: tool.display,
                  description: tool.description,
                  fields: tool.fields.map((field) => ({
                    ...field,
                    value: drafts.get(field.id) ?? field.value,
                  })),
                  groups: [
                    {
                      actions: [
                        { ...tool.action, disabled: false, primary: true },
                        {
                          id: `${active.slice(4)}-unavailable`,
                          label: "Unavailable action",
                          disabled: true,
                          primary: false,
                        },
                      ],
                    },
                  ],
                  blocks: tool.blocks,
                }
              : {}),
          };
        };
        window.studioCalls = [];
        window.studioPendingRun = null;
        window.studioPendingIdle = null;
        window.studioIdleAfterCheckpoint = false;
        window.studioHoldRun = false;
        window.studioState = {
          active: true,
          locale: profile.locale,
          theme: { mode: profile.mode, motion: "full", tokens },
          view: initialView,
          fields: {},
          checkpoint: null,
          busy: false,
          dirty: false,
        };
        window.sendStudio = (patch) => {
          window.studioState = { ...window.studioState, ...patch };
          window.studioPort.postMessage({ type: "state", value: patch });
        };
        window.addEventListener("message", (event) => {
          if (event.data?.type !== "starter:ready") return;
          const channel = new MessageChannel();
          window.studioPort = channel.port1;
          channel.port1.onmessage = ({ data }) => {
            window.studioCalls.push(data);
            let result;
            if (data.method === "checkpoint") {
              window.studioState.checkpoint = JSON.parse(data.params.value);
              if (window.studioIdleAfterCheckpoint) {
                window.studioIdleAfterCheckpoint = false;
                window.studioPendingIdle = () => {
                  window.studioPendingIdle = null;
                  window.sendStudio({ busy: false });
                };
              }
              result = undefined;
            } else if (data.method === "artifact") result = false;
            else if (data.method === "run") {
              for (const [id, value] of Object.entries(data.params.fields))
                drafts.set(id, value);
              const active = data.params.action.startsWith("tab-")
                ? data.params.action
                : "tab-studio";
              result = toolView(active);
              if (data.params.action === "workspace-export")
                result.artifacts = [
                  {
                    name: "studio.json",
                    media_type: "application/json",
                    content: "{}",
                  },
                ];
              const held = window.studioHoldRun;
              const finish = () => {
                window.studioPendingRun = null;
                const fields = Object.fromEntries(
                  result.fields.map((field) => [field.id, field.value]),
                );
                // 宿主视图可能早于 run 回执和最终空闲快照到达，覆盖锁定期间的三次渲染。
                window.sendStudio({ view: result, fields });
                window.studioIdleAfterCheckpoint = held;
                channel.port1.postMessage({ id: data.id, result });
                if (!held) window.sendStudio({ busy: false });
              };
              window.sendStudio({ busy: true });
              if (window.studioHoldRun) {
                window.studioHoldRun = false;
                window.studioPendingRun = finish;
              } else finish();
              return;
            }
            channel.port1.postMessage({ id: data.id, result });
          };
          event.source.postMessage(
            { type: "starter:connect", version: 1 },
            "*",
            [channel.port2],
          );
          channel.port1.postMessage({
            type: "state",
            value: window.studioState,
          });
        });
        const iframe = document.createElement("iframe");
        iframe.sandbox = "allow-scripts";
        iframe.srcdoc = embedded;
        document.body.append(iframe);
      },
      { embedded, profile },
    );
    const frame = page.frames().find((candidate) => candidate.parentFrame());
    await expect(frame.locator("#node-count")).toHaveText("5");
    await expect(frame.locator("[data-starter-initial-paint]")).toHaveCount(0);
    await expect(frame.locator("main")).toHaveAttribute("data-playing", "true");
    const navigation = frame.locator("#studio-nav");
    const before = await navigation.boundingBox();
    const reused = await frame.locator("[data-node=n2]").evaluate((node) => {
      window.retainedNode = node;
      return true;
    });
    assert.equal(reused, true);
    const profileResult = { ...profile, scenes: [], screenshots: [] };
    const checkScene = async (scene) => {
      await frame.locator(`#studio-tab-${scene}`).click();
      await expect(frame.locator(`#scene-${scene}`)).toBeVisible();
      if (scene === "tools")
        await expect(frame.locator("#fields textarea")).toHaveValue(
          "A retained tool draft",
        );
      await frame.evaluate(() => window.scrollTo(0, 0));
      const after = await navigation.boundingBox();
      assert.ok(
        Math.abs(after.x - before.x) < 1 &&
          Math.abs(after.y - before.y) < 1 &&
          Math.abs(after.width - before.width) < 1,
        `${profile.name}/${scene}: navigation moved`,
      );
      if (scene === "canvas") {
        const compactness = await frame.evaluate(() => {
          const console = document
            .querySelector("#scene-canvas .studio-console")
            .getBoundingClientRect();
          const title = document
            .querySelector("#scene-canvas h2")
            .getBoundingClientRect();
          return {
            inset: title.left - console.left,
            noteHeight: document
              .querySelector("#node-detail")
              .getBoundingClientRect().height,
          };
        });
        assert.ok(
          compactness.inset >= 12,
          `${profile.name}: heading needs readable card padding`,
        );
        assert.ok(
          compactness.noteHeight <= 160,
          `${profile.name}: inspector notes pushed the canvas footer away`,
        );
      }
      const overflow = await frame.evaluate(() => ({
        width: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll("body *")]
          .filter((node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.width > 0 &&
              bounds.right > document.documentElement.clientWidth + 2 &&
              getComputedStyle(node).position !== "fixed"
            );
          })
          .map((node) => node.id || node.className)
          .slice(0, 8),
      }));
      assert.ok(
        overflow.content <= overflow.width + 1,
        `${profile.name}/${scene}: horizontal overflow ${JSON.stringify(overflow)}`,
      );
      const screenshot = join(output, `${profile.name}-${scene}.png`);
      await page.screenshot({ path: screenshot });
      profileResult.scenes.push(scene);
      profileResult.screenshots.push(screenshot);
    };
    await checkScene("canvas");
    await checkScene("lens");
    await expect(frame.locator("#lens-count")).toHaveText("8");
    await expect(frame.locator("#lens-total")).toHaveText("526");
    await expect(frame.locator("#lens-chart .bar-fill")).toHaveCount(8);
    await checkScene("flow");
    await frame.locator("#flow-run").click();
    await expect(frame.locator("#flow-count")).toHaveText("8 / 3");
    assert.deepEqual(
      await frame
        .locator("#flow-table tbody tr")
        .evaluateAll((rows) =>
          rows.map((row) => [...row.cells].map((cell) => cell.textContent)),
        ),
      [
        ["Build", "Build", "247"],
        ["Design", "Design", "182"],
        ["Research", "Research", "97"],
      ],
    );
    await checkScene("flow");
    assert.equal(
      await page.evaluate(
        () => window.studioCalls.filter((call) => call.method === "run").length,
      ),
      0,
    );
    await checkScene("canvas");
    assert.equal(
      await frame.evaluate(
        () => window.retainedNode === document.querySelector("[data-node=n2]"),
      ),
      true,
    );
    await checkScene("tools");
    await expect(frame.locator("#fields textarea")).toHaveValue(
      "A retained tool draft",
    );
    await frame.locator("#fields textarea").fill("Draft survives scenes");
    await frame.locator("#studio-tab-canvas").click();
    await frame.locator("#studio-tab-tools").click();
    await expect(frame.locator("#fields textarea")).toHaveValue(
      "Draft survives scenes",
    );
    assert.equal(
      await page.evaluate(
        () => window.studioCalls.filter((call) => call.method === "run").length,
      ),
      1,
    );
    await frame
      .locator('[data-field="text"]')
      .fill("Draft survives tool tabs and scenes");
    await frame.locator('[data-field="text"]').evaluate((input) => {
      input.setSelectionRange(2, 8);
    });
    await frame.evaluate(() => {
      window.retainedToolTabs = [
        ...document.querySelectorAll("#tabs [role=tab]"),
      ];
      window.toolSwitchTrace = {
        running: true,
        samples: [],
        animations: [],
      };
      const animate = Element.prototype.animate;
      window.restoreToolAnimation = () => {
        Element.prototype.animate = animate;
      };
      Element.prototype.animate = function (frames, options) {
        if (this.id === "panel" || this.id === "scene-tools")
          window.toolSwitchTrace.animations.push({ id: this.id, frames });
        return animate.call(this, frames, options);
      };
      const sample = () => {
        const trace = window.toolSwitchTrace;
        if (!trace.running) return;
        const panel = document.querySelector("#panel");
        const controls = [
          ...document.querySelectorAll(
            '#tabs [role=tab], #fields input, #fields select, #fields textarea, #actions [data-action]:not([data-action$="-unavailable"])',
          ),
        ];
        trace.samples.push({
          selected: document.querySelector('#tabs [aria-selected="true"]')
            ?.dataset.action,
          busy: document.querySelector("main").getAttribute("aria-busy"),
          panelOpacity: getComputedStyle(panel).opacity,
          panelTransform: getComputedStyle(panel).transform,
          controls: controls.map((node) => ({
            id: node.id || node.dataset.action,
            opacity: getComputedStyle(node).opacity,
          })),
          disabledOpacity: getComputedStyle(
            document.querySelector('#actions [data-action$="-unavailable"]'),
          ).opacity,
        });
        requestAnimationFrame(sample);
      };
      sample();
    });
    const renderingFrames = async (count) =>
      frame.evaluate(
        (remaining) =>
          new Promise((done) => {
            const next = () => {
              remaining--;
              if (remaining > 0) requestAnimationFrame(next);
              else done();
            };
            requestAnimationFrame(next);
          }),
        count,
      );
    profileResult.toolSwitches = [];
    for (const [index, tool] of [
      "data",
      "todo",
      "connections",
      "text",
      "data",
      "text",
    ].entries()) {
      const countBefore = await page.evaluate(
        () => window.studioCalls.filter((call) => call.method === "run").length,
      );
      await page.evaluate(() => {
        if (window.studioPendingRun || window.studioPendingIdle)
          throw new Error("A run is still pending");
        window.studioHoldRun = true;
      });
      await frame.evaluate((tool) => {
        window.retainedToolInput = document.querySelector(
          "#fields input, #fields select, #fields textarea",
        );
        const target = document.querySelector(`[data-action="tab-${tool}"]`);
        target.focus();
        target.click();
        // DOM 点击跳过 Playwright 对禁用控件的等待，验证页面锁会拒绝连续导航。
        document
          .querySelector('#tabs [role=tab]:not([aria-busy="true"])')
          .click();
        target.click();
      }, tool);
      await expect
        .poll(() =>
          page.evaluate(() => typeof window.studioPendingRun === "function"),
        )
        .toBe(true);
      await expect(frame.locator("main")).toHaveAttribute("aria-busy", "true");
      await expect(
        frame.locator(`[data-action="tab-${tool}"]`),
      ).toHaveAttribute("aria-busy", "true");
      await renderingFrames(6);
      const pending = await frame.evaluate(
        (tool) => ({
          retainedInput:
            window.retainedToolInput ===
            document.querySelector(
              "#fields input, #fields select, #fields textarea",
            ),
          retainedTabs: [
            ...document.querySelectorAll("#tabs [role=tab]"),
          ].every(
            (node, position) => node === window.retainedToolTabs[position],
          ),
          focused:
            document.activeElement ===
            document.querySelector(`[data-action="tab-${tool}"]`),
        }),
        tool,
      );
      assert.deepEqual(pending, {
        retainedInput: true,
        retainedTabs: true,
        focused: true,
      });
      assert.equal(
        await page.evaluate(
          () =>
            window.studioCalls.filter((call) => call.method === "run").length,
        ),
        countBefore + 1,
        `${profile.name}/${tool}: rapid clicks submitted another run`,
      );
      await page.evaluate(() => window.studioPendingRun());
      await expect(
        frame.locator(`[data-action="tab-${tool}"]`),
      ).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() =>
          page.evaluate(() => typeof window.studioPendingIdle === "function"),
        )
        .toBe(true);
      // 检查点回执可能早于宿主空闲快照，让最后一段锁定状态实际绘制数帧。
      await renderingFrames(6);
      await expect(frame.locator("main")).toHaveAttribute("aria-busy", "true");
      await page.evaluate(() => window.studioPendingIdle());
      await expect(frame.locator("main")).toHaveAttribute("aria-busy", "false");
      await renderingFrames(12);
      assert.equal(
        await frame.evaluate(
          (tool) =>
            document.activeElement ===
            document.querySelector(`[data-action="tab-${tool}"]`),
          tool,
        ),
        true,
        `${profile.name}/${tool}: committing a tool changed keyboard focus`,
      );
      if (tool === "data") {
        if (index === 0)
          await frame
            .locator('[data-field="data-source"]')
            .fill("label,category,value\nRetained data draft,Design,57");
        else
          await expect(frame.locator('[data-field="data-source"]')).toHaveValue(
            "label,category,value\nRetained data draft,Design,57",
          );
      }
      if (tool === "text") {
        await expect(frame.locator('[data-field="text"]')).toHaveValue(
          "Draft survives tool tabs and scenes",
        );
        assert.deepEqual(
          await frame
            .locator('[data-field="text"]')
            .evaluate((input) => [input.selectionStart, input.selectionEnd]),
          [2, 8],
          `${profile.name}: text selection was not restored`,
        );
      }
      profileResult.toolSwitches.push(tool);
    }
    const trace = await frame.evaluate(() => {
      window.toolSwitchTrace.running = false;
      window.restoreToolAnimation();
      return {
        ...window.toolSwitchTrace,
        retainedTabs: [...document.querySelectorAll("#tabs [role=tab]")].every(
          (node, position) => node === window.retainedToolTabs[position],
        ),
      };
    });
    assert.ok(trace.samples.length >= 6 * 18);
    const dimmed = trace.samples.find(
      (sample) =>
        sample.panelOpacity !== "1" ||
        sample.panelTransform !== "none" ||
        sample.controls.some((control) => control.opacity !== "1") ||
        sample.disabledOpacity !== "0.5",
    );
    assert.equal(
      dimmed,
      undefined,
      `${profile.name}: switching flickered or hid disabled feedback: ${JSON.stringify(dimmed)}`,
    );
    assert.deepEqual(
      trace.animations,
      [],
      `${profile.name}: switching animated the entire tool panel`,
    );
    assert.equal(trace.retainedTabs, true);
    profileResult.toolSwitchSamples = trace.samples.length;
    await page.evaluate(() => window.sendStudio({ active: false }));
    await expect(frame.locator("main")).toHaveAttribute(
      "data-playing",
      "false",
    );
    await page.evaluate(() =>
      window.sendStudio({
        active: true,
        theme: { ...window.studioState.theme, motion: "reduced" },
      }),
    );
    await expect(frame.locator("main")).toHaveAttribute(
      "data-playing",
      "false",
    );
    assert.deepEqual(errors, [], `${profile.name}: page errors`);
    report.profiles.push(profileResult);
    console.log(
      `PASS ${profile.name}: stable navigation, no overflow, real chart/pipeline values, flicker-free tool tabs, retained nodes/drafts, active/reduced motion`,
    );
    await page.close();
  }
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Screenshots and report: ${output}`);
} finally {
  await browser?.close();
  if (server)
    await new Promise((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done())),
    );
  assert.ok(
    resolve(temporary).startsWith(`${resolve(cache)}\\`) ||
      resolve(temporary).startsWith(`${resolve(cache)}/`),
  );
  await rm(temporary, { recursive: true });
}

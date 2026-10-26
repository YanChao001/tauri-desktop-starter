// Headless integration: production React surfaces + packaged HTML + real offline Wasm.
// Native window controls, file dialogs, keyring and Tauri IPC are deliberately outside this fixture.
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { readUiDocuments } from "../scripts/extension-ui-resources.mjs";
import { createBoundaryServices } from "./extensions/service-fixture.mjs";

const root = resolve(import.meta.dirname, ".."),
  cache = join(root, ".cache");
const output = join(root, "artifacts/extensions/custom-ui"),
  port = 1449;
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(cache, "extension-ui-"));
const tool =
  process.env.STARTER_EXTENSION_TOOL ||
  join(
    root,
    "src-tauri/target/debug",
    process.platform === "win32" ? "extension-tool.exe" : "extension-tool",
  );
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sdk = await readFile(join(root, "sdk/extension-ui.js"), "utf8");
// Mirror document-start all-frame initialization, including WebView2's core globals.
const bootstrap = await readFile(
  join(root, "src-tauri/src/native-ipc.js"),
  "utf8",
);
const init =
  'Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{}});\n' +
  bootstrap
    .replaceAll("__INVOKE_KEY__", JSON.stringify("fixture-invoke-key"))
    .replaceAll("__STARTER_OS_NAME__", JSON.stringify("windows")) +
  "\n" +
  sdk.replace(
    'location.hostname !== "extension-ui.localhost"',
    '(location.hostname !== "127.0.0.1" || !location.pathname.startsWith("/fixture/ui/"))',
  ) +
  `
  window.__audioResumeStates=[];window.__audioSuspendStates=[];
  if(window.AudioContext){const resume=AudioContext.prototype.resume;AudioContext.prototype.resume=function(...args){const result=resume.apply(this,args);result.then(()=>window.__audioResumeStates.push(this.state));return result;};}
  if(window.AudioContext){const suspend=AudioContext.prototype.suspend;AudioContext.prototype.suspend=function(...args){const result=suspend.apply(this,args);result.then(()=>window.__audioSuspendStates.push(this.state));return result;};}
  window.__viewTransitionProbe={starts:0,clips:[]};
  if(document.startViewTransition){const start=document.startViewTransition.bind(document);document.startViewTransition=function(callback){window.__viewTransitionProbe.starts++;return start(callback);};}
  const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(options?.pseudoElement==="::view-transition-new(root)")window.__viewTransitionProbe.clips.push({frames,options});return animate.call(this,frames,options);};
  `;
const csp = (
  await readFile(join(root, "src-tauri/src/extension_ui.rs"), "utf8")
).match(/pub const UI_CSP: &str = "([^"]+)"/)[1];
const names = [
  "scientific-calculator",
  "snake",
  "lan-chat",
  "wallpaper-browser",
  "lab",
];
const selectedNames = process.argv
  .slice(2)
  .filter((value) => !value.startsWith("--"));
const selectedProfiles = process.argv
  .find((value) => value.startsWith("--profiles="))
  ?.slice("--profiles=".length)
  .split(",")
  .map(Number);
if (
  selectedNames.some((name) => !names.includes(name)) ||
  selectedProfiles?.some((index) => ![0, 1, 2].includes(index))
)
  throw Error("Use plugin names and optional --profiles=0,1,2");
const sharedInputs = Object.fromEntries(
  await Promise.all(
    [
      "sdk/extension-ui.js",
      "src/features/extensions/extension-custom-ui.tsx",
      "src/features/extensions/extension-app.tsx",
      "src/pages/extension-window.tsx",
      "src/components/title-bar.tsx",
      "src/hooks/use-theme-switch.ts",
      "src-tauri/src/native-ipc.js",
      "src-tauri/src/extension_ui.rs",
      "e2e/extensions/main.tsx",
      "e2e/extensions/fixture.css",
      "e2e/extensions/native.ts",
      "e2e/extensions/providers.tsx",
      "e2e/extensions/service-fixture.mjs",
    ].map(async (path) => [path, hash(await readFile(join(root, path)))]),
  ),
);
const services = createBoundaryServices();
const plugins = [],
  calls = [],
  leases = new Map(),
  report = [];
let serial = 0,
  server,
  browser;
function runTool(action, plugin, fixture) {
  const args = [
    action,
    "--manifest",
    plugin.manifestPath,
    "--wasm",
    plugin.wasmPath,
    "--ui",
    plugin.uiPath,
  ];
  if (fixture) args.push("--fixture", fixture);
  return JSON.parse(
    execFileSync(tool, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}
async function body(request) {
  const buffers = [];
  let size = 0;
  for await (const buffer of request) {
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw Error("Fixture request too large");
    buffers.push(buffer);
  }
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}
function json(response, value, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}
async function cleanupFixture() {
  if (
    dirname(temporary) !== cache ||
    !basename(temporary).startsWith("extension-ui-")
  )
    throw Error("Unexpected UI fixture directory");
  await rm(temporary, { recursive: true });
}
async function observeSdk(frame) {
  await frame.locator("html").evaluate(async () => {
    window.__sdkSnapshot = await starter.ready;
    starter.onChange((snapshot) => {
      window.__sdkSnapshot = snapshot;
    });
  });
}
async function idle(page, frame) {
  await expect
    .poll(
      () => frame.locator("html").evaluate(() => window.__sdkSnapshot?.busy),
      { timeout: 60000 },
    )
    .toBe(false);
  await expect
    .poll(() => frame.locator("main").getAttribute("aria-busy"), {
      timeout: 60000,
    })
    .not.toBe("true");
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-extension-surface]")
        ?.closest("[aria-busy]")
        ?.getAttribute("aria-busy") !== "true",
  );
}
async function settled(frame) {
  await frame.locator("html").evaluate(async () => {
    await document.fonts.ready;
    let quiet = 0;
    for (let iteration = 0; iteration < 120 && quiet < 3; iteration++) {
      for (const element of document.querySelectorAll("main *"))
        void getComputedStyle(element).color;
      const animations = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState !== "finished" &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        );
      quiet = animations.length ? 0 : quiet + 1;
      await Promise.allSettled(
        animations.map((animation) => animation.finished),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    }
    if (quiet < 3) throw Error("Theme animations did not settle");
  });
}
try {
  for (const name of names) {
    const source =
      name === "lab"
        ? join(root, "examples/extensions/apps")
        : join(root, "marketplace/plugins", name);
    const manifest = JSON.parse(
      await readFile(join(source, "extension.json"), "utf8"),
    );
    const artifact =
      name === "lab"
        ? join(root, "resources/extensions/demo-apps.wasm")
        : join(
            root,
            "marketplace/target",
            name,
            "wasm32-unknown-unknown/release",
            JSON.parse(await readFile(join(source, "build.json"), "utf8"))
              .artifact,
          );
    const wasm = await readFile(artifact),
      uiDocuments = await readUiDocuments(manifest, join(source, "ui"));
    const plugin = {
      name,
      manifest,
      uiDocuments,
      manifestPath: join(temporary, `${name}.json`),
      wasmPath: join(temporary, `${name}.wasm`),
      uiPath: join(temporary, `${name}-ui.json`),
    };
    await Promise.all([
      writeFile(plugin.manifestPath, JSON.stringify(manifest)),
      writeFile(plugin.wasmPath, wasm),
      writeFile(plugin.uiPath, JSON.stringify(uiDocuments)),
    ]);
    const validated = runTool("validate", plugin);
    if (!validated.validated || validated.uiDocuments?.length !== 1)
      throw Error(`Missing native UI validation: ${name}`);
    plugin.item = {
      generation: 1,
      origin: { kind: "local" },
      enabled: true,
      grantedPermissions: [
        ...manifest.permissions,
        ...manifest.optionalPermissions.filter((permission) =>
          ["messaging:lan", "wallpapers:manage"].includes(permission),
        ),
      ],
      package: {
        manifest,
        sha256: hash(wasm),
        bytes: wasm.length,
        uiDocuments: validated.uiDocuments,
      },
      previousPackage: null,
      previousOrigin: null,
    };
    plugin.inputHashes = {
      ...sharedInputs,
      manifest: hash(JSON.stringify(manifest)),
      wasm: hash(wasm),
      ui: hash(JSON.stringify(uiDocuments)),
    };
    plugins.push(plugin);
  }
  for (const file of [
    "index.html",
    "main.tsx",
    "native.ts",
    "providers.tsx",
    "fixture.css",
  ])
    await copyFile(join(root, "e2e/extensions", file), join(temporary, file));
  const aliases = [
    { find: "@/lib/tauri", replacement: join(temporary, "native.ts") },
    ...["i18n", "settings", "unsaved-work", "commands"].map((name) => ({
      find: `@/providers/${name}`,
      replacement: join(temporary, "providers.tsx"),
    })),
    { find: "@", replacement: join(root, "src") },
  ];
  await build({
    root: temporary,
    configFile: false,
    plugins: [react(), tailwind()],
    resolve: { alias: aliases },
    build: { target: "es2022" },
    logLevel: "warn",
  });
  const fixture = {
    name: "extension-ui-fixture",
    configurePreviewServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = new URL(request.url, "http://fixture").pathname;
        try {
          if (path === "/fixture/config")
            return json(response, {
              snapshot: {
                revision: 1,
                items: plugins.map((plugin) => plugin.item),
                runs: [],
              },
            });
          if (path.startsWith("/fixture/ui/")) {
            const token = path.split("/").at(-1),
              plugin = leases.get(token);
            if (!plugin) {
              response.writeHead(403);
              return response.end("Unavailable fixture UI");
            }
            response.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": csp,
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
              "X-DNS-Prefetch-Control": "off",
              "X-Content-Type-Options": "nosniff",
            });
            return response.end(plugin.uiDocuments.main);
          }

          if (path.startsWith("/fixture/")) {
            if (request.method !== "POST") throw Error("POST required");
            const input = await body(request);
            if (path === "/fixture/close") {
              leases.delete(input.token);
              return json(response, null);
            }
            const plugin = plugins.find(
              (plugin) => plugin.manifest.id === input.id,
            );
            if (
              !plugin ||
              input.expectedGeneration !== 1 ||
              input.expectedSha256 !== plugin.item.package.sha256 ||
              (path !== "/fixture/service" &&
                !plugin.manifest.commands.some(
                  (command) =>
                    command.id === input.commandId &&
                    command.resultFormat === "view",
                ))
            )
              throw Error("Invalid fixture identity");
            if (path === "/fixture/service") {
              const required =
                input.service === "lan" ? "messaging:lan" : "wallpapers:manage";
              if (
                !plugin.item.grantedPermissions.includes(required) ||
                (input.service === "lan" && plugin.name !== "lan-chat") ||
                (input.service === "wallpaper" &&
                  plugin.name !== "wallpaper-browser")
              )
                throw Error("Undeclared boundary service");
              return json(response, services.request(input));
            }
            if (path === "/fixture/open") {
              const token = randomBytes(24).toString("hex");
              leases.set(token, plugin);
              return json(response, { token, url: `/fixture/ui/${token}` });
            }
            if (path === "/fixture/view") {
              const fixturePath = join(temporary, `request-${++serial}.json`);
              await writeFile(
                fixturePath,
                JSON.stringify({
                  command: input.commandId,
                  input: input.request,
                  expectJsonSubset: { version: 2 },
                }),
              );
              const result = runTool("test", plugin, fixturePath);
              if (result.smoke?.passed !== true)
                throw Error("Wasm fixture failed");
              calls.push({
                plugin: plugin.name,
                action: input.request.action,
                fields: input.request.fields,
              });
              return json(response, result.smoke.output);
            }
            throw Error("Unknown fixture operation");
          }
          response.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'",
          );
          next();
        } catch (error) {
          console.error(
            "Boundary fixture rejected request",
            path,
            error.message,
          );
          json(
            response,
            { code: "EXTENSION_RUN_FAILED", message: error.message },
            500,
          );
        }
      });
    },
  };
  server = await preview({
    root: temporary,
    configFile: false,
    plugins: [fixture],
    preview: { host: "127.0.0.1", port, strictPort: true },
  });
  browser = await chromium.launch({ headless: true });
  const profiles = [
    {
      language: "zh",
      theme: "light",
      width: 1120,
      height: 800,
      font: "16px",
      window: "false",
    },
    {
      language: "en",
      theme: "dark",
      width: 900,
      height: 760,
      font: "16px",
      window: "false",
    },
    {
      language: "zh",
      theme: "light",
      width: 360,
      height: 760,
      font: "20px",
      window: "true",
    },
  ];
  for (const profile of process.argv.some((value) =>
    ["--security-only", "--settings-only"].includes(value),
  )
    ? []
    : profiles.filter(
        (_profile, index) =>
          !selectedProfiles || selectedProfiles.includes(index),
      )) {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      reducedMotion: "reduce",
    });
    await context.addInitScript({ content: init });
    for (const name of names.filter(
      (name) => !selectedNames.length || selectedNames.includes(name),
    )) {
      const page = await context.newPage(),
        errors = [],
        warnings = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          warnings.push(message.text());
      });
      await page.goto(
        `http://127.0.0.1:${port}/?${new URLSearchParams({ ...profile, plugin: name })}`,
      );
      const frame = page.frameLocator("iframe");
      await expect(frame.locator("h1")).toBeVisible({ timeout: 60000 });
      await observeSdk(frame);
      await idle(page, frame);
      const before = calls.length;
      async function action(id) {
        const previous = calls.length;
        await frame.locator(`[data-action="${id}"]`).click();
        await expect
          .poll(() => calls.length, { timeout: 60000 })
          .toBeGreaterThan(previous);
        await idle(page, frame);
      }
      const beforeServices = services.calls.length;
      if (name === "scientific-calculator") {
        await frame.locator("#expression").fill("2^3^2");
        await action("calculate");
        await expect(frame.locator("#result")).toHaveText("512");
        await frame.locator("#angle").selectOption("deg");
        await frame.locator("#expression").fill("sin(90)");
        await action("calculate");
        await expect(frame.locator("#result")).toHaveText("1");
        await frame.locator("#functions").fill("x^2-4");
        for (const [id, value] of [
          ["xmin", "0"],
          ["xmax", "3"],
          ["ymin", "-5"],
          ["ymax", "6"],
        ])
          await frame.locator("#" + id).fill(value);
        await action("plot");
        await expect(frame.locator("#legend span")).toHaveCount(1);
        await frame.locator("#curve").selectOption("0");
        await frame.locator("#a").fill("0");
        await frame.locator("#b").fill("3");
        await action("root");
        expect(
          Number(await frame.locator("#result").textContent()),
        ).toBeCloseTo(2, 8);
        await frame.locator("#b").fill("2");
        await action("integrate");
        expect(
          Number(await frame.locator("#result").textContent()),
        ).toBeCloseTo(-16 / 3, 8);
        await action("export");
        expect(
          await page.evaluate(() => window.__extensionUiTest.artifacts.length),
        ).toBeGreaterThan(0);
        await expect(frame.locator("#artifacts button")).toBeVisible();
        await frame.locator("#expression").fill("42+1");
        await expect
          .poll(() =>
            frame
              .locator("html")
              .evaluate(
                () => window.__sdkSnapshot?.checkpoint?.fields?.expression,
              ),
          )
          .toBe("42+1");
      } else if (name === "snake") {
        await frame.locator("#start").click();
        await frame.locator("#board").focus();
        await page.keyboard.press("ArrowDown");
        await expect
          .poll(
            () =>
              frame
                .locator("html")
                .evaluate(() =>
                  window.__sdkSnapshot?.checkpoint?.moves?.includes("down"),
                ),
            { timeout: 10000 },
          )
          .toBe(true);
        await page.keyboard.press("Space");
        await expect(frame.locator("#overlay")).toBeVisible();
        await expect
          .poll(() =>
            frame
              .locator("html")
              .evaluate(() =>
                window.__audioSuspendStates?.includes("suspended"),
              ),
          )
          .toBe(true);
        await frame.locator("#start").click();
        await expect
          .poll(() =>
            frame
              .locator("html")
              .evaluate(() => window.__audioResumeStates?.includes("running")),
          )
          .toBe(true);
        await page.keyboard.press("Space");
        await expect(frame.locator("#overlay")).toBeVisible();
        const replay = await frame.locator("html").evaluate(async () =>
          starter.run("validate", {
            checkpoint: JSON.stringify(window.__sdkSnapshot.checkpoint),
          }),
        );
        expect(replay.description).toMatch(/Wasm/);
      } else if (name === "lan-chat") {
        await expect(frame.locator("#nickname")).toHaveValue("Fixture device");
        await frame.locator("#nickname").fill("Fixture tester");
        await frame.locator("#start").click();
        await expect(frame.locator("#stop")).toBeEnabled();
        await frame.locator("#address").fill("192.168.1.21");
        await frame.locator("#connect").click();
        await expect(frame.locator("#contacts [data-peer]")).toHaveCount(1);
        await frame.locator("#draft").fill("Fixture message 你好");
        await frame.locator("#send").click();
        await expect(frame.locator("#draft")).toHaveValue("");
        await expect(frame.locator("#messages")).toContainText(
          "Fixture message 你好",
        );
        const sendsBefore = services.calls.filter(
          (call) => call.service === "lan" && call.request.action === "send",
        ).length;
        await frame.locator("#draft").fill("Multiline draft");
        await frame.locator("#draft").press("Shift+Enter");
        await expect(frame.locator("#draft")).toHaveValue("Multiline draft\n");
        expect(
          services.calls.filter(
            (call) => call.service === "lan" && call.request.action === "send",
          ).length,
        ).toBe(sendsBefore);
        await frame.locator("#draft").fill("IME draft");
        await frame.locator("#draft").dispatchEvent("keydown", {
          key: "Enter",
          code: "Enter",
          isComposing: true,
          bubbles: true,
        });
        await expect(frame.locator("#draft")).toHaveValue("IME draft");
        expect(
          services.calls.filter(
            (call) => call.service === "lan" && call.request.action === "send",
          ).length,
        ).toBe(sendsBefore);
        await frame.locator("#draft").fill("Keyboard message");
        await frame.locator("#draft").press("Enter");
        await expect(frame.locator("#draft")).toHaveValue("");
        await expect(frame.locator("#messages")).toContainText(
          "Keyboard message",
        );
        await frame.locator("#draft").fill("Retained unsent draft");
        const chatLayout = await frame.locator(".chat").evaluate((node) => ({
          headerBottom: node.querySelector(".chat-head").getBoundingClientRect()
            .bottom,
          logTop: node.querySelector("#messages").getBoundingClientRect().top,
          logBottom: node.querySelector("#messages").getBoundingClientRect()
            .bottom,
          composerTop: node.querySelector("#composer").getBoundingClientRect()
            .top,
        }));
        expect(chatLayout.headerBottom).toBeLessThanOrEqual(
          chatLayout.logTop + 1,
        );
        expect(chatLayout.logBottom).toBeLessThanOrEqual(
          chatLayout.composerTop + 1,
        );
        await frame.locator("#export").click();
        await expect
          .poll(() =>
            page.evaluate(() => window.__extensionUiTest.artifacts.length),
          )
          .toBeGreaterThan(0);
        await expect(frame.locator("#draft")).toHaveValue(
          "Retained unsent draft",
        );
        expect(
          await page.evaluate(
            () => window.__extensionUiTest.artifacts[0].content,
          ),
        ).toContain("Fixture message 你好");
      } else if (name === "wallpaper-browser") {
        await expect(frame.locator("#import")).toBeEnabled();
        await expect(frame.locator("#network-mode")).toHaveCSS(
          "box-sizing",
          "border-box",
        );
        await expect(frame.locator("#network-mode")).toHaveCSS(
          "min-height",
          `${parseFloat(profile.font) * 2}px`,
        );
        await frame.locator("#query").fill("landscape");
        await frame.locator("#search").click();
        await frame.locator('#results [data-page-id="123"]').click();
        await expect(frame.locator("#preview-image")).toBeVisible();
        await frame.locator("#download-original").click();
        await expect(frame.locator("#notice")).toContainText(
          profile.language === "zh" ? "取消" : "cancelled",
        );
        await frame.locator("#add-to-gallery").click();
        await frame.locator("#local-tab").click();
        const card = frame.locator(
          '#gallery [data-wallpaper-id="' + "f".repeat(64) + '"]',
        );
        await expect(card).toBeVisible();
        await card.locator('[data-action="apply"]').click();
        await expect(card).toHaveClass(/active/);
        await card.locator('[data-action="rename"]').click();
        await expect(frame.locator("#confirm-dialog")).toBeVisible();
        await frame.locator("#rename-value").fill("Unsaved rename");
        await frame.locator("#dialog-cancel").click();
        await expect(card.locator("h2")).toHaveText("Fixture landscape");
        await card.locator('[data-action="remove"]').click();
        await frame.locator("#dialog-cancel").click();
        await expect(card).toBeVisible();
        await frame.locator("#import").click();
        await expect(frame.locator("#notice")).toContainText(
          profile.language === "zh" ? "取消" : "cancelled",
        );
        await expect
          .poll(() =>
            frame
              .locator("html")
              .evaluate(() => window.__sdkSnapshot.checkpoint?.tab),
          )
          .toBe("local");
      } else {
        await frame.locator('[data-field="text"]').fill("hello 你好");
        await frame.locator('[data-field="mode"]').selectOption("upper");
        await action("analyze");
        await expect(frame.locator("#results pre")).toContainText("HELLO 你好");
        await action("tab-data");
        await action("data-sample-csv");
        await expect(
          frame.locator("#results table:visible").first(),
        ).toBeVisible();
        await action("tab-todo");
        await frame.locator('[data-field="todo"]').fill("Retain task draft");
        await action("tab-connections");
        await action("tab-todo");
        await expect(frame.locator('[data-field="todo"]')).toHaveValue(
          "Retain task draft",
        );
      }
      // Import an unchanged export from real Wasm. Only the read-only Rust view
      // validation boundary is substituted; this must never execute another Wasm action.
      const toolsLabel =
        profile.language === "zh" ? "扩展工具" : "Extension tools";
      await page.getByRole("button", { name: toolsLabel, exact: true }).click();
      const exportedBefore = await page.evaluate(
        () => window.__extensionUiTest.exports.length,
      );
      await settled(page);
      const hostDefaultControl = await page
        .getByRole("button", {
          name: profile.language === "zh" ? "导出会话" : "Export session",
          exact: true,
        })
        .evaluate((node) => ({
          height: node.getBoundingClientRect().height,
          fontSize: getComputedStyle(node).fontSize,
          boxSizing: getComputedStyle(node).boxSizing,
        }));
      expect(hostDefaultControl.height).toBeCloseTo(
        parseFloat(profile.font) * 2,
        0,
      );
      await page
        .getByRole("button", {
          name: profile.language === "zh" ? "导出会话" : "Export session",
          exact: true,
        })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => window.__extensionUiTest.exports.length),
        )
        .toBe(exportedBefore + 1);
      const exported = await page.evaluate(() =>
        window.__extensionUiTest.exports.at(-1),
      );
      await page.keyboard.press("Escape");
      if (name === "scientific-calculator")
        await frame.locator("#expression").fill("999");
      else if (name === "lab")
        await frame.locator('[data-field="todo"]').fill("Changed after export");
      else if (name === "lan-chat")
        await frame.locator("#draft").fill("Changed after export");
      else if (name === "wallpaper-browser") {
        await frame.locator("#remote-tab").click();
        await frame.locator("#query").fill("Changed after export");
      }
      const importedFrame = await page.locator("iframe").elementHandle();
      const callsBeforeImport = calls.length;
      await page.getByRole("button", { name: toolsLabel, exact: true }).click();
      await page
        .getByLabel(
          profile.language === "zh" ? "导入会话 JSON" : "Import session JSON",
          { exact: true },
        )
        .setInputFiles({
          name: exported.name,
          mimeType: "application/json",
          buffer: Buffer.from(exported.content),
        });
      await page
        .getByRole("dialog")
        .getByRole("button", {
          name:
            profile.language === "zh"
              ? "替换当前会话"
              : "Replace current session",
          exact: true,
        })
        .click();
      await importedFrame.waitForElementState("hidden");
      await observeSdk(frame);
      await idle(page, frame);
      expect(calls.length).toBe(callsBeforeImport);
      await page.keyboard.press("Escape");
      // Common host tools sit outside plugin content. Rebuilding only the frame
      // must restore checkpoints/fields without restarting the Wasm session.
      const beforeReload = calls.length;
      const oldFrame = await page.locator("iframe").elementHandle();
      await page
        .getByRole("button", {
          name: profile.language === "zh" ? "扩展工具" : "Extension tools",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: profile.language === "zh" ? "重新加载界面" : "Reload interface",
          exact: true,
        })
        .click();
      await page.keyboard.press("Escape");
      await oldFrame.waitForElementState("hidden");
      await observeSdk(frame);
      await idle(page, frame);
      expect(calls.length).toBe(beforeReload);
      if (name === "scientific-calculator") {
        await expect(frame.locator("#expression")).toHaveValue("42+1");
        await expect(frame.locator("#functions")).toHaveValue("x^2-4");
      } else if (name === "snake") {
        await expect(frame.locator("#overlay")).toBeVisible();
        const checkpoint = await frame
          .locator("html")
          .evaluate(() => window.__sdkSnapshot.checkpoint);
        await page.waitForTimeout(250);
        expect(
          await frame
            .locator("html")
            .evaluate(() => window.__sdkSnapshot.checkpoint.moves),
        ).toEqual(checkpoint.moves);
      } else if (name === "lan-chat")
        await expect(frame.locator("#draft")).toHaveValue(
          "Retained unsent draft",
        );
      else if (name === "wallpaper-browser") {
        await expect(frame.locator("#query")).toHaveValue("landscape");
        await expect(frame.locator("#local-tab")).toHaveAttribute(
          "aria-selected",
          "true",
        );
      } else
        await expect(frame.locator('[data-field="todo"]')).toHaveValue(
          "Retain task draft",
        );
      const beforeShort = await page.locator("iframe").boundingBox();
      await page.evaluate(() => {
        window.__shortTaskSpinner = false;
        window.__shortTaskObserver = new MutationObserver(() => {
          if (
            document.querySelector(
              ".app-main .animate-spin,.app-main [role=progressbar]",
            )
          )
            window.__shortTaskSpinner = true;
        });
        window.__shortTaskObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      await frame
        .locator("html")
        .evaluate(async () =>
          starter.checkpoint(
            window.__sdkSnapshot.checkpoint,
            window.__sdkSnapshot.dirty,
          ),
        );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const afterShort = await page.locator("iframe").boundingBox();
      expect(Math.abs(afterShort.y - beforeShort.y)).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(afterShort.height - beforeShort.height),
      ).toBeLessThanOrEqual(0.5);
      expect(
        await page.evaluate(() => {
          window.__shortTaskObserver.disconnect();
          return window.__shortTaskSpinner;
        }),
      ).toBe(false);
      await settled(frame);
      await expect
        .poll(() =>
          frame
            .locator("html")
            .evaluate(() =>
              Array.from(document.fonts).some(
                (face) =>
                  face.family.replaceAll('"', "") === "Geist Variable" &&
                  face.status === "loaded",
              ),
            ),
        )
        .toBe(true);
      await expect(frame.locator("style[data-starter-defaults]")).toHaveCount(
        1,
      );
      const defaults = await frame.locator("html").evaluate(() => ({
        scrollbar: getComputedStyle(
          document.documentElement,
          "::-webkit-scrollbar",
        ).width,
        font: getComputedStyle(document.documentElement).fontFamily,
        controls: [...document.querySelectorAll("input,select,button")]
          .filter((node) => node.getBoundingClientRect().height > 0)
          .slice(0, 15)
          .map((node) => ({
            id: node.id,
            action: node.dataset.action,
            height: node.getBoundingClientRect().height,
            minHeight: getComputedStyle(node).minHeight,
            fontSize: getComputedStyle(node).fontSize,
            boxSizing: getComputedStyle(node).boxSizing,
          })),
      }));
      defaults.hostDefaultControl = hostDefaultControl;
      expect(defaults.scrollbar).toBe("8px");
      if (name === "lab") {
        expect(
          defaults.controls.find((control) => control.id === "field-todo")
            .height,
        ).toBeCloseTo(hostDefaultControl.height, 0);
        defaults.tabs = await frame
          .locator("#tabs button")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              selected: node.getAttribute("aria-selected") === "true",
              background: getComputedStyle(node).backgroundColor,
              color: getComputedStyle(node).color,
            })),
          );
        const selectedTab = defaults.tabs.find((tab) => tab.selected);
        const otherTabs = defaults.tabs.filter((tab) => !tab.selected);
        expect(otherTabs).toHaveLength(3);
        for (const tab of otherTabs)
          expect(tab.background).not.toBe(selectedTab.background);
      }
      if (["lan-chat", "wallpaper-browser"].includes(name)) {
        const normal = defaults.controls.find(
          (control) =>
            control.id === (name === "lan-chat" ? "start" : "settings"),
        );
        expect(normal.boxSizing).toBe("border-box");
        expect(parseFloat(normal.minHeight)).toBe(parseFloat(profile.font) * 2);
        expect(parseFloat(normal.fontSize)).toBe(
          parseFloat(profile.font) * 0.875,
        );
      }
      const overflow = await page.evaluate(() => ({
        root: document.documentElement.scrollWidth > innerWidth + 1,
        main: [...document.querySelectorAll(".app-main")].some(
          (node) => node.scrollWidth > node.clientWidth + 1,
        ),
      }));
      expect(overflow).toEqual({ root: false, main: false });
      expect(
        await frame
          .locator("html")
          .evaluate((node) => node.scrollWidth > innerWidth + 1),
      ).toBe(false);
      expect(
        await frame
          .locator("html")
          .evaluate((node) => getComputedStyle(node).fontSize),
      ).toBe(profile.font);
      expect(
        await frame.locator("html").evaluate(() => {
          try {
            return !!parent.document;
          } catch {
            return false;
          }
        }),
      ).toBe(false);
      expect(
        await frame
          .locator("html")
          .evaluate(
            () => typeof window.__TAURI_INTERNALS__?.postMessage === "function",
          ),
      ).toBe(false);
      if (profile.window === "true") {
        await expect(
          page.getByRole("button", {
            name: profile.language === "zh" ? "切换主题" : "Toggle theme",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("combobox", {
            name: profile.language === "zh" ? "语言" : "Language",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name:
              profile.language === "zh" ? "打开快速操作" : "Open quick actions",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: profile.language === "zh" ? "最小化" : "Minimize",
            exact: true,
          }),
        ).toBeVisible();
      }
      const violations = (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations;
      expect(
        violations.map((value) => ({
          id: value.id,
          nodes: value.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      await page.screenshot({
        path: join(output, `${name}-${profile.language}-${profile.width}.png`),
      });
      report.push({
        plugin: name,
        inputHashes: plugins.find((plugin) => plugin.name === name).inputHashes,
        profile,
        authorUiLanguageCoverage:
          name === "lan-chat"
            ? "Chinese author UI; English profile covers host and SDK locale/theme only"
            : "Chinese and English author UI",
        actualWasmActions: calls.slice(before).map((call) => call.action),
        errors,
        warnings,
        axeViolations: violations.length,
        nativeIpc: false,
        defaults,
        shortCheckpointStable: true,
        serviceBoundaryMock: services.calls.slice(beforeServices),
        sessionViewValidationBoundaryMock: await page.evaluate(
          () =>
            window.__extensionUiTest.sessionViewValidationBoundaryMockCalls > 0,
        ),
      });
      await writeFile(
        join(output, "progress.json"),
        JSON.stringify({ cases: report }, null, 2),
      );
      console.log(
        `PASS ${name} ${profile.language} ${profile.width}px ${profile.window === "true" ? "standalone" : "embedded"}`,
      );
      await page.close();
    }
    await context.close();
  }
  if (
    !process.argv.includes("--security-only") &&
    (!selectedNames.length || selectedNames.includes("scientific-calculator"))
  ) {
    const context = await browser.newContext({
      viewport: { width: 1120, height: 800 },
      reducedMotion: "no-preference",
    });
    await context.addInitScript({ content: init });
    const first = await context.newPage(),
      second = await context.newPage();
    const url = `http://127.0.0.1:${port}/?plugin=scientific-calculator&window=true&language=zh&theme=light&motion=full&font=16px`;
    await first.goto(url);
    const child = first.frameLocator("iframe");
    await expect(child.locator("h1")).toBeVisible({ timeout: 60000 });
    await observeSdk(child);
    await idle(first, child);
    await child.locator("#expression").fill("123+4");
    await expect
      .poll(() =>
        child
          .locator("html")
          .evaluate(() => window.__sdkSnapshot?.checkpoint?.fields?.expression),
      )
      .toBe("123+4");
    await second.goto(url);
    await expect(second.frameLocator("iframe").locator("h1")).toBeVisible({
      timeout: 60000,
    });
    await second.evaluate(() =>
      window.__extensionSettingsTest.update({
        language: "en",
        accent: "indigo",
        radius: "round",
        font: "mono",
      }),
    );
    await expect(child.locator("html")).toHaveAttribute("lang", "en");
    await idle(first, child);
    await expect(child.locator("#expression")).toHaveValue("123+4");
    const hostFont = await first
      .locator("html")
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(
      await child
        .locator("html")
        .evaluate((node) => getComputedStyle(node).fontFamily),
    ).toBe(hostFont);
    const hostRadius = await first
      .locator("html")
      .evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--radius").trim(),
      );
    expect(
      await child
        .locator("html")
        .evaluate((node) =>
          getComputedStyle(node).getPropertyValue("--radius").trim(),
        ),
    ).toBe(hostRadius);
    await first.bringToFront();
    await first
      .getByRole("button", { name: "Toggle theme", exact: true })
      .click();
    await expect
      .poll(
        () =>
          child
            .locator("html")
            .evaluate((node) => node.classList.contains("dark")),
        { timeout: 10000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          child
            .locator("html")
            .evaluate(() => window.__viewTransitionProbe.clips.length),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    const childTransition = await child
      .locator("html")
      .evaluate(() => window.__viewTransitionProbe);
    expect(childTransition.starts).toBeGreaterThan(0);
    expect(childTransition.clips.at(-1).frames.clipPath[0]).toMatch(
      /^circle\(0px at/,
    );
    expect(childTransition.clips.at(-1).options.pseudoElement).toBe(
      "::view-transition-new(root)",
    );
    expect(childTransition.clips.at(-1).options.duration).toBe(520);
    expect(
      await first.evaluate(() => window.__viewTransitionProbe.starts),
    ).toBeGreaterThan(0);
    await settled(child);
    await second.evaluate(() =>
      window.__extensionSettingsTest.update({ theme: "light", language: "zh" }),
    );
    await expect(child.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect
      .poll(() =>
        child
          .locator("html")
          .evaluate((node) => node.classList.contains("light")),
      )
      .toBe(true);
    await idle(first, child);
    await expect(child.locator("#expression")).toHaveValue("123+4");
    await writeFile(
      join(output, "cross-window-settings.json"),
      JSON.stringify(
        {
          settingsBoundaryMock: true,
          nativeSettingsSync: false,
          actualSdk: true,
          realViewTransition: childTransition,
          retainedDraft: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS reactive cross-window settings fixture, real SDK snapshots/font/radius and circular View Transition",
    );
    await context.close();
  }
  const securityPage = await browser.newPage();
  await securityPage.context().addInitScript({ content: init });
  let externalRequests = 0;
  await securityPage.route("https://denied.invalid/**", (route) => {
    externalRequests++;
    return route.abort();
  });
  await securityPage.goto(
    `http://127.0.0.1:${port}/?plugin=scientific-calculator&window=true`,
  );
  const securityFrame = securityPage.frameLocator("iframe");
  await expect(securityFrame.locator("main")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 60000 },
  );
  const restrictions = await securityFrame
    .locator("html")
    .evaluate(async () => {
      let networkBlocked = false,
        storageBlocked = false,
        rtcBlocked = false;
      try {
        await fetch("https://denied.invalid/fetch");
      } catch {
        networkBlocked = true;
      }
      try {
        void localStorage.length;
      } catch {
        storageBlocked = true;
      }
      try {
        const connection = new RTCPeerConnection({ iceServers: [] });
        connection.close();
      } catch {
        rtcBlocked = true;
      }
      const nested = document.createElement("iframe");
      nested.src = "about:blank";
      document.body.append(nested);
      let recoveredRtc = false;
      try {
        recoveredRtc =
          typeof nested.contentWindow.RTCPeerConnection === "function";
      } catch {
        // An opaque or blocked descendant cannot expose its globals.
      }
      nested.remove();
      return { networkBlocked, storageBlocked, rtcBlocked, recoveredRtc };
    });
  expect(restrictions).toEqual({
    networkBlocked: true,
    storageBlocked: true,
    rtcBlocked: true,
    recoveredRtc: false,
  });
  await securityFrame.locator("html").evaluate(() => {
    location.href = "https://denied.invalid/navigation";
  });
  await securityPage.waitForTimeout(250);
  expect(externalRequests).toBe(0);
  await securityPage.close();
  console.log(
    "PASS opaque-origin storage, WebRTC, direct fetch and navigation restrictions",
  );
  await writeFile(
    join(output, "security.json"),
    JSON.stringify(
      { restrictions, externalRequests, nativeProtocol: false },
      null,
      2,
    ),
  );
  await writeFile(
    join(
      output,
      process.argv.includes("--security-only")
        ? "security-run.json"
        : "report.json",
    ),
    JSON.stringify(
      {
        cases: report,
        provenance: plugins.map((plugin) => ({
          id: plugin.manifest.id,
          version: plugin.manifest.version,
          minHostVersion: plugin.manifest.minHostVersion,
          wasm: plugin.item.package.sha256,
          ui: plugin.item.package.uiDocuments,
        })),
        nativeIpc: false,
        serviceNativeBoundary:
          "LAN and wallpaper services are explicit browser boundaryMock substitutes",
        sessionValidationNativeBoundary:
          "Imports reuse unchanged real-Wasm exports; Rust view parsing is boundaryMock here",
      },
      null,
      2,
    ),
  );
} catch (error) {
  const pages = [];
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages()) {
      const state = { url: page.url() };
      try {
        state.child = await page
          .frameLocator("iframe")
          .locator("html")
          .evaluate(() => ({
            notice: document.querySelector("#notice")?.textContent,
            error: document.querySelector("#error")?.textContent,
            draft: document.querySelector("#draft")?.value,
            snapshotBusy: window.__sdkSnapshot?.busy,
            defaultControl: [
              ...document.querySelectorAll("#start,#field-todo,#network-mode"),
            ].map((node) => ({
              id: node.id,
              boxSizing: getComputedStyle(node).boxSizing,
              height: node.getBoundingClientRect().height,
              fontSize: getComputedStyle(node).fontSize,
            })),
          }));
        await page.screenshot({
          path: join(output, `failure-${pages.length}.png`),
        });
      } catch {
        // The failed page may already have detached its opaque child.
      }
      pages.push(state);
    }
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        pages,
        cases: report,
        services: services.calls,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  if (server)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  await cleanupFixture();
}

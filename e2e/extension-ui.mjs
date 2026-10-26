// Headless integration: production React surfaces + packaged HTML + real offline Wasm.
// Native window controls, file dialogs, keyring and Tauri IPC are deliberately outside this fixture.
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readUiDocuments } from "../scripts/extension-ui-resources.mjs";
import { createBoundaryServices } from "./extensions/service-fixture.mjs";
import {
  checkCalculatorGestures,
  checkCalculatorBusyDraft,
  checkLanPolling,
} from "./extensions/regressions.mjs";
import {
  installPaintProbe,
  checkInitialPaint,
} from "./extensions/paint-probe.mjs";
import {
  checkChrome,
  checkNormalControls,
  checkSelectPopup,
  checkToolsHelp,
  frameGeometry,
  stableFrameGeometry,
  checkHostScroll,
  checkPermissionConsent,
  checkWallpaperCapabilityBoundaries,
} from "./extensions/surface-checks.mjs";

const root = resolve(import.meta.dirname, ".."),
  cache = join(root, ".cache");
// 并行审查可使用独立报告目录，不改动其他运行产生的截图和诊断。
const runId = process.env.STARTER_EXTENSION_UI_RUN_ID;
if (runId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(runId))
  throw Error("STARTER_EXTENSION_UI_RUN_ID must be a bounded plain identifier");
const output = join(root, "artifacts/extensions/custom-ui", runId ?? "");
let port = 0;
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
function installStartupProbe() {
  const now = () => performance.timeOrigin + performance.now();
  if (window === window.top) {
    const events = [];
    window.__extensionStartupEvents = events;
    const record = (value) => {
      if (events.length < 50) events.push({ at: now(), ...value });
    };
    record({ type: "fixture:top-document-start" });
    window.addEventListener("message", (event) => {
      const type = event.data?.type;
      if (
        ![
          "starter:ready",
          "starter:failed",
          "starter:painted",
          "fixture:startup-probe",
        ].includes(type)
      )
        return;
      const frame = document.querySelector("iframe");
      record({
        type,
        origin: event.origin,
        version: event.data.version,
        sourceMatchesCurrentIframe: event.source === frame?.contentWindow,
        iframePresent: !!frame,
        iframeSrc: frame?.getAttribute("src")?.slice(0, 512),
        documentState: document.readyState,
        detail:
          type === "fixture:startup-probe" ? event.data.detail : undefined,
      });
    });
    document.addEventListener(
      "load",
      (event) => {
        if (event.target instanceof HTMLIFrameElement)
          record({
            type: "fixture:iframe-load",
            iframeSrc: event.target.getAttribute("src")?.slice(0, 512),
          });
      },
      true,
    );
  } else {
    const send = (type, extra = {}) =>
      parent.postMessage(
        {
          type: "fixture:startup-probe",
          detail: {
            type,
            at: now(),
            url: location.href.slice(0, 512),
            documentState: document.readyState,
            ...extra,
          },
        },
        "*",
      );
    send("fixture:child-document-start");
    window.addEventListener("message", (event) => {
      if (event.data?.type === "starter:connect")
        send("starter:connect", {
          sourceMatchesParent: event.source === parent,
          origin: event.origin,
          ports: event.ports.length,
        });
    });
    document.addEventListener("DOMContentLoaded", () =>
      send("fixture:child-dom-content-loaded", {
        sdkPresent: typeof window.starter === "object",
      }),
    );
    window.addEventListener("load", () =>
      send("fixture:child-load", {
        sdkPresent: typeof window.starter === "object",
      }),
    );
  }
}
const init =
  `(${installPaintProbe.toString()})();\n` +
  'Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{}});\n' +
  bootstrap
    .replaceAll("__INVOKE_KEY__", JSON.stringify("fixture-invoke-key"))
    .replaceAll("__STARTER_OS_NAME__", JSON.stringify("windows")) +
  `\n(${installStartupProbe.toString()})();\n` +
  sdk.replace(
    'location.hostname !== "extension-ui.localhost"',
    '(location.hostname !== "127.0.0.1" || !location.pathname.startsWith("/fixture/ui/"))',
  ) +
  `
  if(window!==window.top)parent.postMessage({type:"fixture:startup-probe",detail:{type:"fixture:after-sdk",at:performance.timeOrigin+performance.now(),url:location.href.slice(0,512),documentState:document.readyState,sdkPresent:typeof window.starter==="object"}},"*");
  window.__iframeProtocolRequests=[];window.__protocolErrors=[];
  window.addEventListener("message",event=>{if(window===window.top&&event.data?.type==="fixture:protocol-probe")window.__iframeProtocolRequests.push(event.data.value);});
  const postPortMessage=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(message,...args){
    if(window!==window.top&&message?.version===1&&Number.isInteger(message.id)&&typeof message.method==="string")parent.postMessage({type:"fixture:protocol-probe",value:{method:message.method,id:message.id,at:performance.timeOrigin+performance.now()}},"*");
    if(window===window.top&&message?.type==="state")window.__latestHostBusy=message.value?.busy;
    let receipt;if(window===window.top&&message?.error){receipt={at:performance.timeOrigin+performance.now(),id:message.id,error:message.error};window.__protocolErrors.push(receipt);}
    const timing=window===window.top&&window.__extensionUiTest?.transportTiming;
    const forward=()=>{if(receipt){receipt.deliveredAt=performance.timeOrigin+performance.now();receipt.deliveredHostBusy=window.__latestHostBusy;}return postPortMessage.call(this,message,...args);};
    if(receipt&&timing?.errorAfterIdle){const queued=performance.now();const deliver=()=>{if(window.__latestHostBusy===true&&performance.now()-queued<10000)setTimeout(deliver,16);else forward();};setTimeout(deliver,16);return;}
    const delay=message?.type==="state"&&message.value?.busy===true?timing?.busyMs:message?.error?timing?.errorMs:0;
    if(delay>0){setTimeout(forward,delay);return;}
    return forward();
  };
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
const busyScenarios = [
  { phaseDelayMs: 0 },
  { transportTimingMock: true, errorDelayMs: 0 },
  { transportTimingMock: true, errorAfterIdle: true },
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
  selectedProfiles?.some((index) => ![0, 1, 2, 3].includes(index))
)
  throw Error("Use plugin names and optional --profiles=0,1,2,3");
const sharedInputs = Object.fromEntries(
  await Promise.all(
    [
      "sdk/extension-ui.js",
      "e2e/extension-ui.mjs",
      "src/features/extensions/extension-custom-ui.tsx",
      "src/features/extensions/extension-app.tsx",
      "src/features/extensions/extension-frame.tsx",
      "src/features/extensions/extension-chrome-slot.tsx",
      "src/features/extensions/extension-loading.tsx",
      "src/features/extensions/extension-help.tsx",
      "src/features/extensions/extension-data.tsx",
      "src/features/extensions/extension-session-import.tsx",
      "src/features/extensions/extension-session-close.tsx",
      "src/features/extensions/extension-session.ts",
      "src/features/extensions/extensions-provider.tsx",
      "src/features/extensions/extension-ui-bridge.ts",
      "src/layouts/app-shell.tsx",
      "src/pages/extension-app.tsx",
      "src/pages/extension-window.tsx",
      "src/components/title-bar.tsx",
      "src/components/app-sidebar.tsx",
      "src/styles/app-navigation.css",
      "src/hooks/use-theme-switch.ts",
      "src-tauri/src/native-ipc.js",
      "src-tauri/src/extension_ui.rs",
      "e2e/extensions/main.tsx",
      "e2e/extensions/fixture.css",
      "e2e/extensions/native.ts",
      "e2e/extensions/providers.tsx",
      "e2e/extensions/service-fixture.mjs",
      "e2e/extensions/regressions.mjs",
      "e2e/extensions/paint-probe.mjs",
      "e2e/extensions/surface-checks.mjs",
    ].map(async (path) => [path, hash(await readFile(join(root, path)))]),
  ),
);
const services = createBoundaryServices();
const pageDiagnostics = new WeakMap();
function observeFixturePage(page) {
  const diagnostics = { network: [], messages: [] };
  pageDiagnostics.set(page, diagnostics);
  const append = (list, value) => {
    if (list.length < 50) list.push({ at: Date.now(), ...value });
  };
  const tracked = (request) => {
    const path = new URL(request.url()).pathname;
    return (
      request.resourceType() === "document" ||
      path === "/fixture/open" ||
      path.startsWith("/fixture/ui/") ||
      path === "/fixture/view"
    );
  };
  const requestIds = new WeakMap();
  let requestSerial = 0;
  page.on("request", (request) => {
    if (!tracked(request)) return;
    requestIds.set(request, ++requestSerial);
    append(diagnostics.network, {
      event: "request",
      id: requestSerial,
      url: request.url().slice(0, 512),
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (tracked(request))
      append(diagnostics.network, {
        event: "response",
        id: requestIds.get(request),
        url: response.url().slice(0, 512),
        status: response.status(),
      });
  });
  page.on("requestfailed", (request) => {
    if (tracked(request))
      append(diagnostics.network, {
        event: "request-failed",
        id: requestIds.get(request),
        url: request.url().slice(0, 512),
        error: request.failure()?.errorText?.slice(0, 1000),
      });
  });
  page.on("pageerror", (error) =>
    append(diagnostics.messages, {
      event: "pageerror",
      message: error.message.slice(0, 2000),
      stack: error.stack?.slice(0, 4000),
    }),
  );
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      append(diagnostics.messages, {
        event: `console-${message.type()}`,
        message: message.text().slice(0, 2000),
        location: message.location(),
      });
  });
  return page;
}
async function newFixturePage(context) {
  return observeFixturePage(await context.newPage());
}
async function startupDiagnostics(page) {
  return {
    ...pageDiagnostics.get(page),
    handshake: await page.evaluate(() => window.__extensionStartupEvents),
  };
}
const plugins = [],
  calls = [],
  leases = new Map(),
  report = [];
let serial = 0,
  server,
  browser;
const executeTool = promisify(execFile);
async function runTool(action, plugin, fixture) {
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
  const { stdout } = await executeTool(tool, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 90000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
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
    window.__sdkStateTransitions = [];
    starter.onChange((snapshot) => {
      window.__sdkSnapshot = snapshot;
      window.__sdkStateTransitions.push({
        at: performance.timeOrigin + performance.now(),
        busy: snapshot.busy,
        expression: snapshot.fields.expression,
        checkpointExpression: snapshot.checkpoint?.fields?.expression,
        xmin: snapshot.fields.xmin,
      });
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
  await expect(page.locator("iframe")).toHaveCSS("opacity", "1", {
    timeout: 15000,
  });
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
    const validated = await runTool("validate", plugin);
    if (!validated.validated || validated.uiDocuments?.length !== 1)
      throw Error(`Missing native UI validation: ${name}`);
    plugin.item = {
      generation: 1,
      origin: { kind: "local" },
      enabled: true,
      grantedPermissions: [
        ...manifest.permissions,
        ...manifest.optionalPermissions.filter(
          (permission) =>
            name === "wallpaper-browser" ||
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
        const requestUrl = new URL(request.url, "http://fixture");
        const path = requestUrl.pathname;
        try {
          if (path === "/fixture/config") {
            const permissionProfile = requestUrl.searchParams.get(
              "wallpaperPermissions",
            );
            return json(response, {
              snapshot: {
                revision: 1,
                items: plugins.map((plugin) => {
                  const item = structuredClone(plugin.item);
                  if (plugin.name === "wallpaper-browser") {
                    if (permissionProfile === "denied")
                      item.grantedPermissions = [
                        ...plugin.manifest.permissions,
                      ];
                    else if (permissionProfile === "direct")
                      item.grantedPermissions = item.grantedPermissions.filter(
                        (permission) => permission !== "network:system-proxy",
                      );
                    else if (permissionProfile === "links-only")
                      item.grantedPermissions = item.grantedPermissions.filter(
                        (permission) =>
                          !["network:images", "network:system-proxy"].includes(
                            permission,
                          ),
                      );
                  }
                  return item;
                }),
                runs: [],
              },
            });
          }
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
              if (
                !Array.isArray(input.boundaryGrantedPermissions) ||
                input.boundaryGrantedPermissions.some(
                  (permission) =>
                    ![
                      ...plugin.manifest.permissions,
                      ...plugin.manifest.optionalPermissions,
                    ].includes(permission),
                ) ||
                (input.service === "lan" && plugin.name !== "lan-chat") ||
                (["wallpaper", "resources", "links"].includes(input.service) &&
                  plugin.name !== "wallpaper-browser")
              )
                throw Error("Undeclared boundary service");
              const captured = services.request(input);
              const latency =
                input.service === "lan"
                  ? Number(
                      input.request.action === "status"
                        ? input.boundaryTiming?.lanStatusMs
                        : input.request.action === "nickname"
                          ? input.boundaryTiming?.lanNicknameMs
                          : 0,
                    )
                  : 0;
              if (Number.isFinite(latency) && latency > 0)
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.min(latency, 2000)),
                );
              return json(response, captured);
            }
            if (path === "/fixture/open") {
              const token = randomBytes(24).toString("hex");
              leases.set(token, plugin);
              return json(response, { token, url: `/fixture/ui/${token}` });
            }
            if (path === "/fixture/view") {
              if (
                Number.isFinite(input.boundaryViewDelayMs) &&
                input.boundaryViewDelayMs > 0
              )
                await new Promise((resolve) =>
                  setTimeout(
                    resolve,
                    Math.min(input.boundaryViewDelayMs, 2000),
                  ),
                );
              let viewRequest = input.request;
              const host = {
                permissions: input.boundaryGrantedPermissions,
                storage: null,
              };
              if (plugin.name === "wallpaper-browser")
                viewRequest = { ...viewRequest, host };
              const seen = new Set();
              for (let round = 0; round < 4; round++) {
                const fixturePath = join(temporary, `request-${++serial}.json`);
                await writeFile(
                  fixturePath,
                  JSON.stringify({
                    command: input.commandId,
                    input: viewRequest,
                    expectJsonSubset: { version: 2 },
                  }),
                );
                const result = await runTool("test", plugin, fixturePath);
                if (result.smoke?.passed !== true)
                  throw Error("Wasm fixture failed");
                calls.push({
                  plugin: plugin.name,
                  action: viewRequest.action,
                  fields: viewRequest.fields,
                });
                const view = result.smoke.output;
                if (!view.effects.length) return json(response, view);
                if (plugin.name !== "wallpaper-browser")
                  throw Error("Unexpected effect in offline UI fixture");
                for (const effect of view.effects) {
                  if (seen.has(effect.id) || seen.size >= 16)
                    throw Error("Repeated or excessive boundary effect");
                  seen.add(effect.id);
                }
                viewRequest = {
                  version: 2,
                  action: "host-result",
                  state: view.state,
                  fields: Object.fromEntries(
                    view.fields.map((field) => [field.id, field.value]),
                  ),
                  locale: input.request.locale,
                  host,
                  results: view.effects.map((effect) =>
                    services.http(input, effect),
                  ),
                };
              }
              throw Error("Too many offline fixture effect rounds");
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
  const address = server.httpServer.address();
  if (!address || typeof address === "string")
    throw Error("The extension UI fixture requires a local TCP address");
  port = address.port;
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
    {
      language: "zh",
      theme: "dark",
      width: 1920,
      height: 1080,
      font: "20px",
      window: "false",
    },
  ];
  for (const profile of process.argv.some((value) =>
    [
      "--security-only",
      "--settings-only",
      "--consent-only",
      "--capabilities-only",
    ].includes(value),
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
      const page = await newFixturePage(context),
        errors = [],
        warnings = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          warnings.push(message.text());
      });
      await page.goto(
        `http://127.0.0.1:${port}/?${new URLSearchParams({ ...profile, plugin: name, snapshotDelayMs: "250" })}`,
      );
      const frame = page.frameLocator("iframe");
      await expect(frame.locator("h1")).toBeVisible({ timeout: 60000 });
      await observeSdk(frame);
      await idle(page, frame);
      const initialPaint = await checkInitialPaint(page, profile.theme);
      expect(initialPaint.skeletonObserved).toBe(true);
      await writeFile(
        join(output, `${name}-${profile.language}-${profile.width}-paint.json`),
        JSON.stringify(initialPaint, null, 2),
      );
      const before = calls.length;
      const chrome = await checkChrome(
        page,
        profile,
        plugins.find((plugin) => plugin.name === name).manifest,
      );
      if (process.argv.includes("--chrome-only")) {
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
        report.push({
          plugin: name,
          inputHashes: plugins.find((plugin) => plugin.name === name)
            .inputHashes,
          profile,
          chrome,
          initialPaint: {
            visibleFrames: initialPaint.visible.length,
            skeletonObserved: initialPaint.skeletonObserved,
          },
          errors,
          warnings,
          nativeIpc: false,
          scope: "Navigation placement and first paint only; no business flow",
        });
        console.log(`PASS ${name} ${profile.width}px navigation placement`);
        await page.close();
        continue;
      }
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
        await frame.locator("#functions").fill("sin(x)\ncos(x)\nx^2 / 10");
        await action("plot");
        await expect(frame.locator("#legend .dot")).toHaveCount(3);
        await expect
          .poll(() =>
            frame.locator("#graph").evaluate((canvas) => {
              const dots = [...document.querySelectorAll("#legend .dot")];
              const swatch = document.createElement("canvas");
              swatch.width = swatch.height = 1;
              const sample = swatch.getContext("2d", {
                willReadFrequently: true,
              });
              const colors = dots.map((dot) => {
                sample.clearRect(0, 0, 1, 1);
                sample.fillStyle = getComputedStyle(dot).backgroundColor;
                sample.fillRect(0, 0, 1, 1);
                return [...sample.getImageData(0, 0, 1, 1).data].slice(0, 3);
              });
              const readback = document.createElement("canvas");
              readback.width = canvas.width;
              readback.height = canvas.height;
              const context = readback.getContext("2d", {
                willReadFrequently: true,
              });
              context.drawImage(canvas, 0, 0);
              const pixels = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
              return colors.map((rgb) => {
                let count = 0;
                for (let offset = 0; offset < pixels.length; offset += 4)
                  if (
                    rgb.every(
                      (value, index) =>
                        Math.abs(value - pixels[offset + index]) <= 5,
                    )
                  )
                    count++;
                return {
                  colored: Math.max(...rgb) - Math.min(...rgb) > 40,
                  visible: count > 10,
                  distinct:
                    new Set(colors.map((color) => color.join(","))).size === 3,
                };
              });
            }),
          )
          .toEqual(
            Array.from({ length: 3 }, () => ({
              colored: true,
              visible: true,
              distinct: true,
            })),
          );
        const graphButtons = await frame
          .locator(".graph-actions > button")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.getBoundingClientRect().height),
          );
        expect(graphButtons).toHaveLength(3);
        expect(
          Math.max(...graphButtons) - Math.min(...graphButtons),
        ).toBeLessThanOrEqual(1);
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
        if (process.argv.includes("--busy-only")) {
          const timingRuns = [];
          for (const timing of busyScenarios) {
            const busyDraft = await checkCalculatorBusyDraft({
              page,
              frame,
              ...timing,
              idle: () => idle(page, frame),
              reload: async () => {
                const language = await page.evaluate(
                  () => window.__extensionSettingsTest.read().language,
                );
                const old = await page.locator("iframe").elementHandle();
                await page
                  .getByRole("button", {
                    name: language === "zh" ? "扩展工具" : "Extension tools",
                    exact: true,
                  })
                  .click();
                await page
                  .getByRole("menuitem", {
                    name:
                      language === "zh" ? "重新加载界面" : "Reload interface",
                    exact: true,
                  })
                  .click();
                await page.keyboard.press("Escape");
                await old.waitForElementState("hidden");
                await observeSdk(frame);
                await idle(page, frame);
              },
            });
            await writeFile(
              join(output, "calculator-busy-draft.json"),
              JSON.stringify(busyDraft, null, 2),
            );
            timingRuns.push(busyDraft);
            await writeFile(
              join(output, "calculator-busy-timing-runs.json"),
              JSON.stringify(timingRuns, null, 2),
            );
          }
          console.log(
            "PASS calculator busy-only last draft survives locale run and reload",
          );
          await page.close();
          continue;
        }
        const popup = await checkSelectPopup(frame, "#angle");
        await writeFile(
          join(
            output,
            `${name}-${profile.language}-${profile.width}-popup.json`,
          ),
          JSON.stringify(popup, null, 2),
        );
        if (process.argv.includes("--stress-pan") || profile.width === 1120) {
          const gesture = await checkCalculatorGestures({
            page,
            frame,
            plotCount: () =>
              calls.filter(
                (call) => call.plugin === name && call.action === "plot",
              ).length,
            idle: () => idle(page, frame),
          });
          const busyDrafts = [];
          for (const timing of busyScenarios) {
            const busyDraft = await checkCalculatorBusyDraft({
              page,
              frame,
              ...timing,
              idle: () => idle(page, frame),
              reload: async () => {
                const language = await page.evaluate(
                  () => window.__extensionSettingsTest.read().language,
                );
                const old = await page.locator("iframe").elementHandle();
                await page
                  .getByRole("button", {
                    name: language === "zh" ? "扩展工具" : "Extension tools",
                    exact: true,
                  })
                  .click();
                await page
                  .getByRole("menuitem", {
                    name:
                      language === "zh" ? "重新加载界面" : "Reload interface",
                    exact: true,
                  })
                  .click();
                await page.keyboard.press("Escape");
                await old.waitForElementState("hidden");
                await observeSdk(frame);
                await idle(page, frame);
              },
            });
            busyDrafts.push(busyDraft);
          }
          await writeFile(
            join(output, "calculator-busy-draft.json"),
            JSON.stringify(busyDrafts, null, 2),
          );
          await writeFile(
            join(output, "calculator-pan-protocol.json"),
            JSON.stringify(gesture, null, 2),
          );
          await expect(frame.locator("#graph")).toBeVisible();
          await idle(page, frame);
          if (process.argv.includes("--regressions-only")) {
            report.push({
              plugin: name,
              inputHashes: plugins.find((plugin) => plugin.name === name)
                .inputHashes,
              profile,
              regression: "calculator-pan",
              maximumPerSecond: gesture.maximumPerSecond,
              nativeIpc: false,
            });
            console.log(
              `PASS calculator actual pan/wheel/keys: ${gesture.requests.length} requests, rolling 1s maximum ${gesture.maximumPerSecond}`,
            );
            await page.close();
            continue;
          }
        }
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
        const artifactAttempts = await page.evaluate(
          () => window.__extensionUiTest.artifacts.length,
        );
        const artifactGeometry = await frame
          .locator("#artifacts button")
          .evaluate((node) => ({
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
            containerWidth: node.parentElement.getBoundingClientRect().width,
            title: node.title,
            text: node.textContent,
          }));
        expect(artifactGeometry.width).toBeLessThanOrEqual(
          artifactGeometry.containerWidth + 1,
        );
        expect(artifactGeometry.title).toBe(artifactGeometry.text);
        expect(artifactGeometry.height).toBeCloseTo(
          parseFloat(profile.font) * 2,
          0,
        );
        const beforeArtifactRetry = calls.length;
        await frame.locator("#artifacts button").click();
        await expect
          .poll(() =>
            page.evaluate(() => window.__extensionUiTest.artifacts.length),
          )
          .toBe(artifactAttempts + 1);
        await idle(page, frame);
        await expect(frame.locator("#artifacts button")).toBeVisible();
        expect(calls.length).toBe(beforeArtifactRetry);
        if (process.argv.includes("--artifact-only")) {
          expect(errors).toEqual([]);
          expect(warnings).toEqual([]);
          expect(
            await frame
              .locator("html")
              .evaluate((node) => node.scrollWidth > innerWidth + 1),
          ).toBe(false);
          report.push({
            plugin: name,
            profile,
            inputHashes: plugins.find((plugin) => plugin.name === name)
              .inputHashes,
            artifactGeometry,
            retainedAfterCancel: true,
            retryWithoutWasmRun: true,
            errors,
            warnings,
            nativeIpc: false,
            scope: "Real calculator actions and cancelled artifact retry only",
          });
          console.log(
            `PASS calculator ${profile.width}px cancelled artifact retry remains within its container`,
          );
          await page.close();
          continue;
        }
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
        const inheritedFont = await frame
          .locator("body")
          .evaluate((node) => getComputedStyle(node).fontFamily);
        await expect(frame.locator("#addresses")).toHaveCSS(
          "font-family",
          inheritedFont,
        );
        if (process.argv.includes("--stress-poll") || profile.width === 1120) {
          const polling = await checkLanPolling(page, frame);
          await writeFile(
            join(output, "lan-polling-regression.json"),
            JSON.stringify(polling, null, 2),
          );
          console.log(
            "PASS delayed stale LAN polls keep controls enabled and edits retained",
          );
          if (process.argv.includes("--regressions-only")) {
            report.push({
              plugin: name,
              inputHashes: plugins.find((plugin) => plugin.name === name)
                .inputHashes,
              profile,
              regression: "lan-polling",
              polling,
              nativeIpc: false,
            });
            await page.close();
            continue;
          }
        }
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
        await expect(frame.locator("#network-mode")).toHaveValue("system");
        const beforeHttp = services.httpCalls.length;
        const popup = await checkSelectPopup(frame, "#network-mode");
        await writeFile(
          join(
            output,
            `${name}-${profile.language}-${profile.width}-popup.json`,
          ),
          JSON.stringify(popup, null, 2),
        );
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
        await idle(page, frame);
        await expect(frame.locator("#results .result")).toHaveCount(2, {
          timeout: 60000,
        });
        const searchCalls = calls
          .slice(before)
          .filter((call) => call.plugin === name);
        expect(searchCalls.some((call) => call.action === "search")).toBe(true);
        expect(searchCalls.some((call) => call.action === "host-result")).toBe(
          true,
        );
        expect(services.httpCalls.slice(beforeHttp)).toHaveLength(1);
        expect(services.httpCalls.at(-1).receipt.value.body).toContain("iusc");
        expect(services.httpCalls.at(-1).request.networkMode).toBe("system");
        expect(
          services.calls
            .slice(beforeServices)
            .some(
              (call) =>
                call.service === "wallpaper" &&
                [
                  "search",
                  "preview",
                  "download-original",
                  "import-remote",
                ].includes(call.request.action),
            ),
        ).toBe(false);
        for (const card of await frame.locator("#results .result").all()) {
          const layout = await card.evaluate((node) => {
            const style = getComputedStyle(node);
            const label = node.querySelector("strong");
            return {
              inset:
                label.getBoundingClientRect().left -
                node.getBoundingClientRect().left,
              expected:
                parseFloat(style.paddingLeft) +
                parseFloat(style.borderLeftWidth),
              overflow: node.scrollWidth - node.clientWidth,
            };
          });
          expect(Math.abs(layout.inset - layout.expected)).toBeLessThanOrEqual(
            1,
          );
          expect(layout.overflow).toBeLessThanOrEqual(1);
        }
        const layoutBeforeFailure = await frame
          .locator("#search-form")
          .evaluate((node) => ({
            top: node.offsetTop,
            height: node.offsetHeight,
          }));
        await frame.locator("#query").fill("fixture-search-failure");
        await frame.locator("#search").click();
        await idle(page, frame);
        const toast = page.locator("[data-sonner-toast]").last();
        await expect(toast).toHaveAttribute("data-type", "error", {
          timeout: 60000,
        });
        await expect(toast).toContainText(
          profile.language === "zh" ? "搜索" : "search",
        );
        await expect(frame.locator("#query")).toHaveValue(
          "fixture-search-failure",
        );
        expect(
          await frame.locator("#search-form").evaluate((node) => ({
            top: node.offsetTop,
            height: node.offsetHeight,
          })),
        ).toEqual(layoutBeforeFailure);
        await expect(frame.locator("#results .result")).toHaveCount(2);
        await frame.locator("#query").fill("landscape");
        await frame.locator("#results .result").first().click();
        await expect(frame.locator("#preview-image")).toBeVisible();
        await expect.poll(() => services.activeResources()).toBe(0);
        await frame.locator("#open-source").click();
        await expect
          .poll(
            () =>
              services.calls.filter((call) => call.service === "links").length,
          )
          .toBeGreaterThan(0);
        await frame.locator("#download-original").click();
        await expect(
          page.locator("[data-sonner-toast]").filter({
            hasText:
              profile.language === "zh" ? "已取消保存。" : "Save cancelled.",
          }),
        ).toBeVisible();
        await expect.poll(() => services.activeResources()).toBe(0);
        await frame.locator("#add-to-gallery").click();
        await idle(page, frame);
        await expect.poll(() => services.activeResources()).toBe(0);
        const resourceCalls = await page.evaluate(() =>
          window.__extensionUiTest.serviceCalls.filter(
            (call) => call.service === "resources",
          ),
        );
        const fetched = resourceCalls.filter(
          (call) => call.request.action === "fetch-image",
        );
        expect(fetched).toHaveLength(3);
        for (const call of fetched) {
          expect(call.completed).toBe(true);
          expect(
            resourceCalls.filter(
              (release) =>
                release.request.action === "release" &&
                release.request.resourceId === call.response.resourceId,
            ),
          ).toHaveLength(1);
        }
        expect(
          resourceCalls
            .filter((call) => call.request.action === "save")
            .map((call) => call.response.cancelled),
        ).toEqual([true]);
        const releasedPreview = await frame
          .locator("html")
          .evaluate(async (_node, resourceId) => {
            try {
              await starter.services.request("resources", {
                action: "preview",
                resourceId,
              });
              return null;
            } catch (error) {
              return error.code;
            }
          }, fetched[0].response.resourceId);
        expect(releasedPreview).toBe("NOT_FOUND");
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
        await expect(
          page.locator("[data-sonner-toast]").filter({
            hasText:
              profile.language === "zh" ? "已取消导入。" : "Import cancelled.",
          }),
        ).toBeVisible();
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
      const toolsHelp = await checkToolsHelp(page, toolsLabel);
      await page.getByRole("button", { name: toolsLabel, exact: true }).click();
      const toolsMenu = page.getByRole("menu", {
        name: toolsLabel,
        exact: true,
      });
      await expect(toolsMenu).toBeVisible();
      await settled(page);
      await expect(
        toolsMenu.locator("input,textarea,select,button,p,h1,h2,h3"),
      ).toHaveCount(0);
      const menuBox = await toolsMenu.boundingBox();
      expect(menuBox.width).toBeLessThanOrEqual(profile.width - 24);
      const menuItems = toolsMenu.getByRole("menuitem");
      expect(await menuItems.count()).toBeGreaterThanOrEqual(
        profile.window === "true" ? 4 : 5,
      );
      for (const item of await menuItems.all()) {
        await expect(item.locator("svg")).toHaveCount(1);
        expect((await item.textContent()).trim().length).toBeGreaterThan(0);
      }
      await page.keyboard.press("Escape");
      const toolsTrigger = page.getByRole("button", {
        name: toolsLabel,
        exact: true,
      });
      await expect(toolsMenu).toHaveCount(0);
      await expect(toolsTrigger).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menuItems.first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(menuItems.last()).toBeFocused();
      await page.keyboard.press("Home");
      await expect(menuItems.first()).toBeFocused();
      toolsHelp.menu = {
        width: menuBox.width,
        items: await menuItems.count(),
        iconsAndText: true,
        noInlineForms: true,
        keyboardNavigation: true,
      };
      const exportedBefore = await page.evaluate(
        () => window.__extensionUiTest.exports.length,
      );
      await settled(page);
      await page
        .getByRole("menuitem", {
          name: profile.language === "zh" ? "导出会话" : "Export session",
          exact: true,
        })
        .click();
      await expect(toolsMenu).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => window.__extensionUiTest.exports.length),
        )
        .toBe(exportedBefore + 1);
      const exported = await page.evaluate(() =>
        window.__extensionUiTest.exports.at(-1),
      );
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
      const beforeImportGeometry = await frameGeometry(page);
      const callsBeforeImport = calls.length;
      await page.getByRole("button", { name: toolsLabel, exact: true }).click();
      await page.evaluate(() => {
        window.__importUiProbe = [];
        document.addEventListener(
          "change",
          (event) => {
            if (
              event.target instanceof HTMLInputElement &&
              event.target.type === "file"
            ) {
              for (const delay of [0, 1, 10, 30, 80, 160, 320])
                setTimeout(
                  () =>
                    window.__importUiProbe.push({
                      at: performance.now(),
                      delay,
                      inputConnected: event.target.isConnected,
                      dialogs: [
                        ...document.querySelectorAll('[role="dialog"]'),
                      ].map((node) => node.textContent),
                      menus: [
                        ...document.querySelectorAll('[role="menu"]'),
                      ].map(
                        (node) =>
                          node.getAttribute("aria-label") ||
                          node.getAttribute("aria-labelledby"),
                      ),
                      alerts: [
                        ...document.querySelectorAll('[role="alert"]'),
                      ].map((node) => node.textContent),
                    }),
                  delay,
                );
            }
          },
          true,
        );
      });
      const importLabel =
        profile.language === "zh" ? "导入会话 JSON" : "Import session JSON";
      const importInput = await page
        .getByLabel(importLabel, { exact: true })
        .elementHandle();
      const chooserPromise = page.waitForEvent("filechooser");
      await page
        .getByRole("menuitem", { name: importLabel, exact: true })
        .click();
      const chooser = await chooserPromise;
      expect(await chooser.element().getAttribute("aria-label")).toBe(
        importLabel,
      );
      await expect(toolsMenu).toHaveCount(0);
      expect(await importInput.evaluate((node) => node.isConnected)).toBe(true);
      toolsHelp.importInputRetainedAfterMenuClose = true;
      await chooser.setFiles({
        name: exported.name,
        mimeType: "application/json",
        buffer: Buffer.from(exported.content),
      });
      const importDialog = page.getByRole("dialog");
      await expect(importDialog).toBeVisible();
      await settled(page);
      const hostDefaultControl = await importDialog
        .getByRole("button", {
          name: profile.language === "zh" ? "取消" : "Cancel",
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
      stableFrameGeometry(beforeImportGeometry, await frameGeometry(page));
      await page.keyboard.press("Escape");
      // Common host tools sit outside plugin content. Rebuilding only the frame
      // must restore checkpoints/fields without restarting the Wasm session.
      const beforeReload = calls.length;
      const beforeReloadGeometry = await frameGeometry(page);
      const oldFrame = await page.locator("iframe").elementHandle();
      await page
        .getByRole("button", {
          name: profile.language === "zh" ? "扩展工具" : "Extension tools",
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", {
          name: profile.language === "zh" ? "重新加载界面" : "Reload interface",
          exact: true,
        })
        .click();
      await page.keyboard.press("Escape");
      await oldFrame.waitForElementState("hidden");
      await observeSdk(frame);
      await idle(page, frame);
      expect(calls.length).toBe(beforeReload);
      stableFrameGeometry(beforeReloadGeometry, await frameGeometry(page));
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
      if (name !== "snake")
        defaults.normalControls = await checkNormalControls(
          frame,
          name,
          profile.font,
        );
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
      const hostScroll = await checkHostScroll(page, profile);
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
        chrome,
        toolsHelp,
        hostScroll,
        startupDiagnostics: await startupDiagnostics(page),
        initialPaint: {
          visibleFrames: initialPaint.visible.length,
          skeletonObserved: initialPaint.skeletonObserved,
        },
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
    ![
      "--security-only",
      "--chrome-only",
      "--artifact-only",
      "--settings-only",
      "--consent-only",
    ].some((flag) => process.argv.includes(flag)) &&
    (!selectedNames.length || selectedNames.includes("wallpaper-browser"))
  ) {
    for (const mode of ["denied", "direct", "links-only"]) {
      const context = await browser.newContext({
        viewport: { width: 900, height: 760 },
        reducedMotion: "reduce",
      });
      await context.addInitScript({ content: init });
      const page = await newFixturePage(context),
        errors = [],
        warnings = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          warnings.push(message.text());
      });
      const beforeHttp = services.httpCalls.length;
      const beforeServices = services.calls.length;
      await page.goto(
        `http://127.0.0.1:${port}/?plugin=wallpaper-browser&window=true&language=zh&theme=light&wallpaperPermissions=${mode}`,
      );
      const frame = page.frameLocator("iframe");
      await expect(frame.locator("h1")).toBeVisible({ timeout: 60000 });
      await observeSdk(frame);
      await idle(page, frame);
      const boundaries = await checkWallpaperCapabilityBoundaries(
        page,
        frame,
        mode,
      );
      await idle(page, frame);
      expect(services.activeResources()).toBe(0);
      const network = services.httpCalls.slice(beforeHttp);
      if (mode === "denied") {
        expect(network).toHaveLength(0);
        expect(
          services.calls
            .slice(beforeServices)
            .filter((call) => call.service === "wallpaper")
            .map((call) => call.request.action),
        ).toEqual(
          expect.arrayContaining([
            "list",
            "apply",
            "rename",
            "import",
            "remove",
          ]),
        );
      } else {
        expect(network).toHaveLength(1);
        expect(network[0].request.networkMode).toBe("direct");
        if (mode === "links-only")
          expect(
            services.calls
              .slice(beforeServices)
              .filter((call) => call.service === "links")
              .map((call) => call.request.url),
          ).toEqual(["https://www.wikipedia.org/one"]);
      }
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      report.push({
        plugin: "wallpaper-browser",
        regression: "optional-network-boundaries",
        ...boundaries,
        offlineHttpBoundaryMock: network,
        nativeIpc: false,
      });
      console.log(
        `PASS wallpaper-browser ${mode} optional network boundary; local gallery retained`,
      );
      await context.close();
    }
  }
  if (
    !process.argv.includes("--security-only") &&
    !process.argv.includes("--chrome-only") &&
    !process.argv.includes("--capabilities-only") &&
    !process.argv.includes("--regressions-only")
  ) {
    for (const language of ["zh", "en"]) {
      const context = await browser.newContext({
        viewport: { width: 360, height: 760 },
        reducedMotion: "reduce",
      });
      await context.addInitScript({ content: init });
      const page = await newFixturePage(context);
      await page.goto(
        `http://127.0.0.1:${port}/?plugin=center&language=${language}&font=20px`,
      );
      for (const name of [
        "lab",
        "scientific-calculator",
        "wallpaper-browser",
      ]) {
        const permissions = await checkPermissionConsent(
          page,
          plugins.find((plugin) => plugin.name === name).manifest,
          language,
          join(output, `permissions-${name}-${language}-360.png`),
        );
        report.push({
          plugin: name,
          regression: "permission-consent",
          language,
          permissions,
          nativeIpc: false,
        });
      }
      await context.close();
    }
  }
  if (
    !process.argv.includes("--security-only") &&
    !process.argv.includes("--capabilities-only") &&
    !process.argv.includes("--regressions-only") &&
    !process.argv.includes("--chrome-only") &&
    !process.argv.includes("--artifact-only") &&
    !process.argv.includes("--consent-only") &&
    (!selectedNames.length || selectedNames.includes("scientific-calculator"))
  ) {
    const context = await browser.newContext({
      viewport: { width: 1120, height: 800 },
      reducedMotion: "no-preference",
    });
    await context.addInitScript({ content: init });
    const first = await newFixturePage(context),
      second = await newFixturePage(context);
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
  if (
    ![
      "--security-only",
      "--settings-only",
      "--capabilities-only",
      "--regressions-only",
      "--chrome-only",
      "--artifact-only",
    ].some((flag) => process.argv.includes(flag)) &&
    (!selectedNames.length || selectedNames.includes("lab"))
  ) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 760 },
      reducedMotion: "reduce",
    });
    await context.addInitScript({ content: init });
    const page = await newFixturePage(context),
      errors = [],
      warnings = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        warnings.push(message.text());
    });
    await page.goto(
      `http://127.0.0.1:${port}/?plugin=lab&window=true&language=zh&theme=light&font=20px&hostDataBoundaryMock=true`,
    );
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("h1")).toBeVisible({ timeout: 60000 });
    await observeSdk(frame);
    await idle(page, frame);
    const before = calls.length;
    const trigger = page.getByRole("button", { name: "扩展工具", exact: true });
    const menu = page.getByRole("menu", { name: "扩展工具", exact: true });
    const dialog = page.getByRole("dialog", { name: "发送数据", exact: true });
    await trigger.click();
    await page
      .getByRole("menuitem", { name: "发送数据…", exact: true })
      .click();
    await expect(menu).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
    await dialog
      .getByLabel("输入文本", { exact: true })
      .fill("Retained host-data draft 你好");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page
      .getByRole("menuitem", { name: "发送数据…", exact: true })
      .click();
    await expect(dialog.getByLabel("输入文本", { exact: true })).toHaveValue(
      "Retained host-data draft 你好",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(calls.length).toBe(before);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    await writeFile(
      join(output, "data-dialog.json"),
      JSON.stringify(
        {
          permissionGrantBoundaryMock: await page.evaluate(
            () => window.__extensionUiTest.permissionGrantBoundaryMock,
          ),
          grantedPermission: "text:read",
          initialFocusInsideDialog: true,
          escapeReturnsFocus: true,
          draftRetainedAfterReopen: true,
          actualAdditionalWasmActions: calls.length - before,
          nativePermissionApproval: false,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS compact menu opens independent data dialog; Escape, focus and draft retained",
    );
    await context.close();
  }
  const securityPage = observeFixturePage(await browser.newPage());
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
      process.argv.includes("--capabilities-only")
        ? "capabilities-run.json"
        : process.argv.includes("--regressions-only")
          ? "regressions-run.json"
          : process.argv.includes("--chrome-only")
            ? "chrome-run.json"
            : process.argv.includes("--artifact-only")
              ? "artifact-run.json"
              : process.argv.includes("--security-only")
                ? "security-run.json"
                : "report.json",
    ),
    JSON.stringify(
      {
        cases: report,
        inputHashes: Object.fromEntries(
          plugins.map((plugin) => [plugin.name, plugin.inputHashes]),
        ),
        provenance: plugins.map((plugin) => ({
          id: plugin.manifest.id,
          version: plugin.manifest.version,
          minHostVersion: plugin.manifest.minHostVersion,
          wasm: plugin.item.package.sha256,
          ui: plugin.item.package.uiDocuments,
        })),
        nativeIpc: false,
        serviceNativeBoundary:
          "LAN, gallery, image-resource and external-link services are explicit browser boundaryMock substitutes; offline HTTP receipts are parsed by real packaged Wasm",
        offlineHttpBoundaryMock: services.httpCalls,
        sessionValidationNativeBoundary:
          "Imports reuse unchanged real-Wasm exports; Rust view parsing is boundaryMock here",
        readinessTimingBoundaryMock:
          "Initial snapshot waits up to 250ms; targeted busy/poll cases deliberately delay real-Wasm/service receipts",
      },
      null,
      2,
    ),
  );
} catch (error) {
  const pages = [];
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages()) {
      const state = { url: page.url(), diagnostics: pageDiagnostics.get(page) };
      try {
        state.startupDiagnostics = await startupDiagnostics(page);
        state.protocolRequests = await page.evaluate(
          () => window.__iframeProtocolRequests,
        );
        state.protocolErrors = await page.evaluate(
          () => window.__protocolErrors,
        );
        state.lifecycle = await page.evaluate(
          () => window.__extensionUiTest?.lifecycle,
        );
        state.helpTiming = await page.evaluate(() => window.__helpTiming);
        state.importProbe = await page.evaluate(() => window.__importUiProbe);
        if (await page.locator("iframe").count())
          state.child = await page
            .frameLocator("iframe")
            .locator("html")
            .evaluate(() => ({
              documentState: document.readyState,
              sdkPresent: typeof window.starter === "object",
              url: location.href,
              notice: document.querySelector("#notice")?.textContent,
              error: document.querySelector("#error")?.textContent,
              draft: document.querySelector("#draft")?.value,
              snapshotBusy: window.__sdkSnapshot?.busy,
              expression: document.querySelector("#expression")?.value,
              fields: window.__sdkSnapshot?.fields,
              checkpoint: window.__sdkSnapshot?.checkpoint,
              stateTransitions: window.__sdkStateTransitions,
              overflow: {
                viewport: innerWidth,
                root: document.documentElement.scrollWidth,
                nodes: [...document.querySelectorAll("body *")]
                  .map((node) => {
                    const rectangle = node.getBoundingClientRect();
                    return {
                      tag: node.tagName,
                      id: node.id,
                      className: node.className,
                      left: rectangle.left,
                      right: rectangle.right,
                      width: rectangle.width,
                      clientWidth: node.clientWidth,
                      scrollWidth: node.scrollWidth,
                      overflow: getComputedStyle(node).overflow,
                      text: node.textContent.slice(0, 120),
                    };
                  })
                  .filter(
                    (node) =>
                      node.right > innerWidth + 1 ||
                      node.left < -1 ||
                      node.scrollWidth > node.clientWidth + 1,
                  )
                  .slice(0, 40),
              },
              defaultControl: [
                ...document.querySelectorAll(
                  "#start,#field-todo,#network-mode",
                ),
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
        inputHashes: Object.fromEntries(
          plugins.map((plugin) => [plugin.name, plugin.inputHashes]),
        ),
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

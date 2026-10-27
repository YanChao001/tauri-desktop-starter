// 独立构建真实宿主路由与隔离界面；无原生进程，不显示浏览器窗口。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cache = join(root, ".cache");
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(join(cache, "extension-navigation-cache-"));
const sourcePath = (path) =>
  JSON.stringify(join(root, path).replaceAll("\\", "/"));
const items = ["alpha", "beta"].map((id) => ({
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: [],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: `fixture.${id}`,
      version: "1.0.0",
      name: id,
      author: "Browser fixture",
      description: "Navigation cache fixture",
      permissions: [],
      optionalPermissions: [],
      network: [],
      commands: [
        {
          id: "open",
          title: "Open",
          function: "app",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
          ui: { sidebar: true, window: true, document: "main" },
        },
      ],
    },
  },
}));
let browser, server;
try {
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>',
  );
  await writeFile(
    join(temporary, "fixture.css"),
    `@import ${sourcePath("src/index.css")};\n@source ${sourcePath("src/features/extensions")};\n@source ${sourcePath("src/components")};\n.app-main{position:relative;height:600px;overflow:auto}`,
  );
  await writeFile(
    join(temporary, "native.ts"),
    `
    export * from ${sourcePath("src/lib/tauri.ts")};
    export function isTauri() { return true; }
    export async function extensionSnapshot() { return { revision: 1, items: ${JSON.stringify(items)}, runs: [] }; }
    export async function onExtensionsChanged() { return () => {}; }
    export async function prepareEnabledExtensions() { window.navigationFixture.preparations++; }
    export async function viewExtension(input) {
      window.navigationFixture.views.push(input.id);
      return {version:2,state:"{}",display:"Ready",description:"",fields:[],groups:[]};
    }
    export async function openExtensionUi(id) {
      window.navigationFixture.leases.push(id);
      return {url:location.origin+"/ui.html?id="+encodeURIComponent(id),token:id};
    }
    export async function closeExtensionUi(token) { window.navigationFixture.closed.push(token); }
    export async function getCurrentWindowLabel() { return "fixture"; }
    export async function extensionRunStatus() { return []; }
    export async function cancelExtension() {}
  `,
  );
  await writeFile(
    join(temporary, "providers.ts"),
    `
    export * from ${sourcePath("src/providers/settings.tsx")};
    export * from ${sourcePath("src/providers/i18n.tsx")};
    export * from ${sourcePath("src/providers/unsaved-work.tsx")};
    export function useSettings() { return {settings:{motion:"full"}}; }
    export function useI18n() { return {language:"en",t:key=>key}; }
    export function useUnsavedWork() {}
  `,
  );
  await writeFile(
    join(temporary, "ui.html"),
    `<!doctype html><body>
    <label for="draft">Document draft</label><input id="draft">
    <script>
      const id=new URL(location.href).searchParams.get("id");
      document.documentElement.dataset.documentId=crypto.randomUUID();
      parent.postMessage({type:"fixture:boot",id},"*");
    </script></body>`,
  );
  await writeFile(
    join(temporary, "fixture.tsx"),
    `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {MemoryRouter,Routes,Route,Link} from "react-router-dom";
    import {APP_ROUTES,extensionNavigation} from ${sourcePath("src/routes.tsx")};
    import {ExtensionsProvider} from ${sourcePath("src/features/extensions/extensions-provider.tsx")};
    import {ExtensionOutlets} from ${sourcePath("src/layouts/extension-outlets.tsx")};
    import "./fixture.css";
    const items=${JSON.stringify(items)};
    const ExtensionPage=APP_ROUTES.find(route=>route.path==="/extensions/app/:extensionId/:commandId").component;
    function Workspace() { return <><nav>
      {extensionNavigation(items).map(route=><Link key={route.path} to={route.path}
        onPointerEnter={route.preload} onFocus={route.preload}>{route.label}</Link>)}
      <Link to="/settings">Settings</Link></nav>
      <main className="app-main"><ExtensionOutlets items={items}/></main></>; }
    createRoot(document.getElementById("root")).render(<ExtensionsProvider><MemoryRouter><Routes>
      <Route element={<Workspace/>}>
        <Route index element={<h1>Home</h1>}/>
        <Route path="settings" element={<h1>Settings page</h1>}/>
        <Route path="extensions/app/:extensionId/:commandId" element={<ExtensionPage/>}/>
      </Route></Routes></MemoryRouter></ExtensionsProvider>);
  `,
  );
  await build({
    configFile: false,
    root: temporary,
    logLevel: "error",
    plugins: [react(), tailwind()],
    resolve: {
      alias: [
        { find: "@/lib/tauri", replacement: join(temporary, "native.ts") },
        ...["settings", "i18n", "unsaved-work"].map((name) => ({
          find: `@/providers/${name}`,
          replacement: join(temporary, "providers.ts"),
        })),
        { find: "@", replacement: join(root, "src") },
      ],
    },
    build: {
      outDir: join(temporary, "dist"),
      emptyOutDir: false,
      rollupOptions: {
        input: [join(temporary, "index.html"), join(temporary, "ui.html")],
      },
    },
  });
  server = await preview({
    configFile: false,
    root: temporary,
    logLevel: "error",
    preview: { host: "127.0.0.1", port: 0 },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const sdk = (
    await readFile(join(root, "sdk/extension-ui.js"), "utf8")
  ).replace(
    'location.hostname !== "extension-ui.localhost"',
    '(location.hostname !== "127.0.0.1" || location.pathname !== "/ui.html")',
  );
  await page.addInitScript({ content: sdk });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.navigationFixture = {
      views: [],
      leases: [],
      closed: [],
      boots: {},
      preparations: 0,
    };
    window.addEventListener("message", (event) => {
      if (event.data?.type !== "fixture:boot") return;
      const boots = window.navigationFixture.boots;
      boots[event.data.id] = (boots[event.data.id] ?? 0) + 1;
    });
  });
  const requests = [],
    failures = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  const pluginRequests = () =>
    requests.filter((url) => /\/extension-app-[^/]+\.js/.test(url));
  assert.equal(pluginRequests().length, 0);
  await page.getByRole("link", { name: "alpha", exact: true }).hover();
  await expect.poll(() => pluginRequests().length).toBeGreaterThan(0);
  assert.deepEqual(
    await page.evaluate(() => window.navigationFixture.views),
    [],
  );
  assert.deepEqual(
    await page.evaluate(() => window.navigationFixture.leases),
    [],
  );
  assert.equal(await page.locator("iframe").count(), 0);
  await page.getByRole("link", { name: "alpha", exact: true }).click();
  const alpha = page.frameLocator('iframe[title="alpha"]');
  await expect(page.locator('iframe[title="alpha"]')).toHaveCSS("opacity", "1");
  await alpha.getByLabel("Document draft").fill("Keep alpha browsing context");
  const alphaId = await alpha.locator("html").getAttribute("data-document-id");
  const alphaFrame = await page
    .locator('iframe[title="alpha"]')
    .elementHandle();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings page" }),
  ).toBeVisible();
  await expect(alpha.locator("html")).toHaveAttribute("data-active", "false");
  const inactiveCode = await alpha.locator("html").evaluate(async () => {
    try {
      await window.starter.notify("Hidden request");
      return "unexpected-success";
    } catch (error) {
      return error.code;
    }
  });
  assert.equal(inactiveCode, "EXTENSION_UNAVAILABLE");
  await page.getByRole("link", { name: "alpha", exact: true }).click();
  await expect(alpha.locator("html")).toHaveAttribute("data-active", "true");
  await expect(alpha.getByLabel("Document draft")).toHaveValue(
    "Keep alpha browsing context",
  );
  assert.equal(
    await alpha.locator("html").getAttribute("data-document-id"),
    alphaId,
  );
  await page.getByRole("link", { name: "beta", exact: true }).click();
  const beta = page.frameLocator('iframe[title="beta"]');
  await expect(page.locator('iframe[title="beta"]')).toHaveCSS("opacity", "1");
  await beta.getByLabel("Document draft").fill("Keep beta browsing context");
  const betaId = await beta.locator("html").getAttribute("data-document-id");
  await page.getByRole("link", { name: "alpha", exact: true }).click();
  await expect(alpha.getByLabel("Document draft")).toHaveValue(
    "Keep alpha browsing context",
  );
  assert.equal(
    await alpha.locator("html").getAttribute("data-document-id"),
    alphaId,
  );
  assert.equal(await alphaFrame.evaluate((node) => node.isConnected), true);
  assert.deepEqual(
    await page
      .locator("iframe")
      .evaluateAll((frames) => frames.map((frame) => frame.title)),
    ["alpha", "beta"],
  );
  await page.getByRole("link", { name: "beta", exact: true }).click();
  await expect(beta.getByLabel("Document draft")).toHaveValue(
    "Keep beta browsing context",
  );
  assert.equal(
    await beta.locator("html").getAttribute("data-document-id"),
    betaId,
  );
  const fixture = await page.evaluate(() => window.navigationFixture);
  assert.equal(fixture.preparations, 1);
  assert.deepEqual(fixture.boots, { "fixture.alpha": 1, "fixture.beta": 1 });
  assert.deepEqual(fixture.views, ["fixture.alpha", "fixture.beta"]);
  assert.deepEqual(fixture.leases, ["fixture.alpha", "fixture.beta"]);
  assert.deepEqual(fixture.closed, []);
  assert.deepEqual(
    requests.filter((url) =>
      /\/(?:safe-markdown|extension-chart)-[^/]+\.js/.test(url),
    ),
    [],
  );
  assert.deepEqual(failures, []);
  process.stdout.write(
    `${JSON.stringify(
      {
        startupPreparationCalls: fixture.preparations,
        navigationPreloadsCodeOnly: true,
        retainedBrowsingContexts: fixture.boots,
        inactiveRequests: inactiveCode,
        markdownAndChartRequests: 0,
        wasmRequests: fixture.views.length,
        uiLeases: fixture.leases.length,
        pageErrors: failures,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser?.close();
  await new Promise((done) =>
    server ? server.httpServer.close(done) : done(),
  );
  assert.equal(dirname(temporary), cache);
  await rm(temporary, { recursive: true, force: true });
}

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
  );
const csp = (
  await readFile(join(root, "src-tauri/src/extension_ui.rs"), "utf8")
).match(/pub const UI_CSP: &str = "([^"]+)"/)[1];
const names = ["arcade-2048", "nonogram", "story-dice", "text-tools", "lab"];
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
      grantedPermissions: [],
      package: {
        manifest,
        sha256: hash(wasm),
        bytes: wasm.length,
        uiDocuments: validated.uiDocuments,
      },
      previousPackage: null,
      previousOrigin: null,
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
              !plugin.manifest.commands.some(
                (command) =>
                  command.id === input.commandId &&
                  command.resultFormat === "view",
              )
            )
              throw Error("Invalid fixture identity");
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
  for (const profile of process.argv.includes("--security-only")
    ? []
    : profiles) {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      reducedMotion: "reduce",
    });
    await context.addInitScript({ content: init });
    for (const name of names.filter(
      (name) => !process.argv[2] || process.argv.slice(2).includes(name),
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
      await page.waitForFunction(
        () =>
          document.querySelector("[aria-busy]")?.getAttribute("aria-busy") ===
          "false",
        null,
        { timeout: 60000 },
      );
      await expect(frame.locator("main")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 60000 },
      );
      const before = calls.length;
      async function action(id) {
        await frame.locator(`[data-action="${id}"]`).click();
        await expect(frame.locator("main")).toHaveAttribute(
          "aria-busy",
          "false",
          { timeout: 60000 },
        );
      }
      if (name === "arcade-2048") {
        await frame.locator("#board").focus();
        await page.keyboard.press("ArrowLeft");
        await expect(frame.locator("#steps")).toHaveText("1", {
          timeout: 60000,
        });
        await expect(frame.locator('[data-action="left"]')).toHaveAttribute(
          "aria-disabled",
          "false",
        );
        await action("undo");
        await expect(frame.locator("#steps")).toHaveText("0");
      } else if (name === "nonogram") {
        await action("cell-0");
        await expect(frame.locator('[data-cell="cell-0"]')).toHaveClass(
          /filled/,
        );
        await frame.locator('[data-cell="cell-0"]').focus();
        await page.keyboard.press("ArrowRight");
        await expect(frame.locator('[data-cell="cell-1"]')).toBeFocused();
        await frame.locator('[data-action="puzzle-1"]').click();
        await expect(frame.getByRole("dialog")).toBeVisible();
        await frame.locator("#cancel").click();
        await expect(frame.locator('[data-action="puzzle-0"]')).toHaveAttribute(
          "aria-selected",
          "true",
        );
      } else if (name === "story-dice") {
        await frame.locator('[data-field="lock-0"]').check();
        await frame.locator("#draft").fill("保留这段测试草稿");
        await action("roll");
        await expect(frame.locator("#draft")).toHaveValue("保留这段测试草稿");
        await expect(frame.locator('[data-field="lock-0"]')).toBeChecked();
        await frame.locator('[data-action="use-prompt"]').click();
        await expect(frame.getByRole("dialog")).toBeVisible();
        await frame.locator("#cancel").click();
        await expect(frame.locator("#draft")).toHaveValue("保留这段测试草稿");
        await action("export");
        expect(
          await page.evaluate(
            () => window.__extensionUiTest.artifacts[0].content,
          ),
        ).toContain("保留这段测试草稿");
        expect(
          await page.evaluate(() => window.__extensionUiTest.work.dirty),
        ).toBe(true);
      } else if (name === "text-tools") {
        await frame.locator("#text").fill("Hello 你好\n");
        await frame.locator("#mode").selectOption("upper");
        await action("apply");
        await expect(frame.locator("#output")).toContainText("HELLO 你好");
        await action("export-txt");
        expect(
          await page.evaluate(
            () => window.__extensionUiTest.artifacts[0].content,
          ),
        ).toContain("HELLO 你好");
      } else {
        await action("tab-text");
        await frame.locator('[data-field="text"]').fill("hello 你好");
        await action("analyze");
        await expect(frame.getByRole("table").first()).toBeVisible();
        await action("tab-game");
        await action("hint");
        await expect(frame.locator(".board")).toBeVisible();
      }
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
      await expect(frame.locator("main")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 60000 },
      );
      expect(calls.length).toBe(beforeReload);
      if (name === "story-dice") {
        await expect(frame.locator("#draft")).toHaveValue("保留这段测试草稿");
        await expect(frame.locator('[data-field="lock-0"]')).toBeChecked();
      } else if (name === "text-tools") {
        await expect(frame.locator("#text")).toHaveValue("Hello 你好\n");
        await expect(frame.locator("#output")).toContainText("HELLO 你好");
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
          page.getByRole("button", { name: "切换主题" }),
        ).toHaveCount(0);
        await expect(page.getByRole("combobox", { name: "语言" })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("button", { name: "最小化" }),
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
        profile,
        actualWasmActions: calls.slice(before).map((call) => call.action),
        errors,
        warnings,
        axeViolations: violations.length,
        nativeIpc: false,
      });
      console.log(
        `PASS ${name} ${profile.language} ${profile.width}px ${profile.window === "true" ? "standalone" : "embedded"}`,
      );
      await page.close();
    }
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
    `http://127.0.0.1:${port}/?plugin=text-tools&window=true`,
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
          wasm: plugin.item.package.sha256,
          ui: plugin.item.package.uiDocuments,
        })),
        nativeIpc: false,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (server)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  await cleanupFixture();
}

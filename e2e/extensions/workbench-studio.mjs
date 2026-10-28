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
const [html, sdk, surfaceTokens, controlStyles] = await Promise.all([
  readFile(join(root, "examples/extensions/apps/ui/main.html"), "utf8"),
  readFile(join(root, "sdk/extension-ui.js"), "utf8"),
  readFile(join(root, "src/styles/surface-tokens.css"), "utf8"),
  readFile(join(root, "src/styles/control-styles.css"), "utf8"),
]);
const styles = `@layer starter-defaults {\n${surfaceTokens}\n${controlStyles}\n}`;
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
      ({ embedded, profile, styles }) => {
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
        const initialView = {
          display: "Studio",
          description: "",
          tabs: [],
          fields: [],
          groups: [],
          blocks: [],
        };
        window.studioCalls = [];
        window.studioState = {
          active: true,
          locale: profile.locale,
          theme: { mode: profile.mode, motion: "full", tokens, styles },
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
            if (data.method === "checkpoint")
              window.studioState.checkpoint = JSON.parse(data.params.value);
            else if (data.method === "artifact") result = false;
            else if (data.method === "run") {
              if (data.params.action !== "workspace-export")
                throw new Error("Unknown workspace action");
              result = {
                ...initialView,
                artifacts: [
                  {
                    name: "studio.json",
                    mediaType: "application/json",
                    encoding: "utf8",
                    content: "{}",
                  },
                ],
              };
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
      { embedded, profile, styles },
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
      `PASS ${profile.name}: stable navigation, no overflow, real chart/pipeline values, retained nodes, active/reduced motion`,
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

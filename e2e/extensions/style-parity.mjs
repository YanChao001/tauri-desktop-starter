// Real host components and CSS are built independently from the injected SDK.
// Run with: node e2e/extensions/style-parity.mjs (headless; no Rust process).
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
const temporary = await mkdtemp(join(cache, "extension-style-parity-"));
const sourcePath = (path) =>
  JSON.stringify(join(root, path).replaceAll("\\", "/"));
let browser, server;
try {
  await writeFile(
    join(temporary, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>',
  );
  await writeFile(
    join(temporary, "fixture.css"),
    `@import ${sourcePath("src/index.css")};\n@source ${sourcePath("src/components/ui")};`,
  );
  await writeFile(
    join(temporary, "native.ts"),
    `
    export * from ${sourcePath("src/lib/tauri.ts")};
    export async function openExtensionUi() { return { url: location.origin + "/ui.html", token: "style-parity" }; }
    export async function closeExtensionUi() {}
  `,
  );
  await writeFile(
    join(temporary, "providers.ts"),
    `
    export function useSettings() { return { settings: { motion: "reduced" } }; }
    export function useI18n() { return { language: "en", t: (key) => key }; }
  `,
  );
  await writeFile(
    join(temporary, "ui.html"),
    `<!doctype html><body>
      <button id="sdk-button" type="button">Button</button>
      <input id="sdk-input-button" type="button" value="Button">
      <input id="sdk-submit" type="submit" value="Submit">
      <input id="sdk-reset" type="reset" value="Reset">
      <button id="sdk-secondary" type="button" data-variant="secondary">Secondary</button>
      <button id="sdk-outline" type="button" data-variant="outline">Outline</button>
      <button id="sdk-ghost" type="button" data-variant="ghost">Ghost</button>
      <button id="sdk-destructive" type="button" data-variant="destructive">Destructive</button>
      <button id="sdk-link" type="button" data-variant="link">Link</button>
      <button id="sdk-disabled" disabled>Disabled</button>
      <input id="sdk-input" placeholder="Input"><input id="sdk-invalid" aria-invalid="true">
      <textarea id="sdk-textarea" placeholder="Textarea"></textarea>
      <select id="sdk-select"><option>Select</option></select>
      <input id="sdk-input-disabled" disabled value="Disabled input">
      <textarea id="sdk-textarea-disabled" disabled>Disabled textarea</textarea>
      <select id="sdk-select-disabled" disabled><option>Disabled select</option></select>
      <input id="sdk-readonly" readonly value="Read only">
      <div id="sdk-card" style="background:var(--surface-card,var(--card))">Card</div>
      <div id="sdk-muted-card" style="background:var(--surface-card-muted,var(--muted))">Muted card</div>
      <input id="sdk-checkbox" type="checkbox" checked><input id="sdk-unchecked" type="checkbox">
      <input id="sdk-indeterminate" type="checkbox"><input id="sdk-radio" type="radio" checked>
      <input id="sdk-range" type="range" min="0" max="100" value="30">
      <input id="sdk-authored" type="button" value="Author"><section id="shadow-host"></section>
    </body>`,
  );
  await writeFile(
    join(temporary, "fixture.tsx"),
    `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { createPortal } from "react-dom";
    import { Card } from ${sourcePath("src/components/ui/card.tsx")};
    import { Button } from ${sourcePath("src/components/ui/button.tsx")};
    import { Input } from ${sourcePath("src/components/ui/input.tsx")};
    import { Textarea } from ${sourcePath("src/components/ui/textarea.tsx")};
    import { Select, SelectTrigger, SelectValue } from ${sourcePath("src/components/ui/select.tsx")};
    import { Checkbox } from ${sourcePath("src/components/ui/checkbox.tsx")};
    import { RadioGroup, RadioGroupItem } from ${sourcePath("src/components/ui/radio-group.tsx")};
    import { ExtensionCustomUi } from ${sourcePath("src/features/extensions/extension-custom-ui.tsx")};
    import "./fixture.css";
    createRoot(document.getElementById("root")!).render(
      <><main className="app-main" style={{inset:"16px auto auto 16px",width:320,display:"grid",gap:12}}>
        <Button id="host-button">Button</Button>
        <Button id="host-secondary" variant="secondary">Secondary</Button>
        <Button id="host-outline" variant="outline">Outline</Button>
        <Button id="host-ghost" variant="ghost">Ghost</Button>
        <Button id="host-destructive" variant="destructive">Destructive</Button>
        <Button id="host-link" variant="link">Link</Button>
        <Button id="host-disabled" disabled>Disabled</Button>
        <Input id="host-input" placeholder="Input" />
        <Input id="host-invalid" aria-invalid="true" />
        <Textarea id="host-textarea" placeholder="Textarea" />
        <Checkbox id="host-checkbox" defaultChecked />
        <Checkbox id="host-unchecked" />
        <Checkbox id="host-indeterminate" checked="indeterminate" />
        <RadioGroup defaultValue="one"><RadioGroupItem id="host-radio" value="one" /></RadioGroup>
        <Select defaultValue="one"><SelectTrigger id="host-select"><SelectValue>Select</SelectValue></SelectTrigger></Select>
        <Input id="host-input-disabled" disabled value="Disabled input" />
        <Textarea id="host-textarea-disabled" disabled value="Disabled textarea" />
        <Select defaultValue="one" disabled><SelectTrigger id="host-select-disabled"><SelectValue>Disabled select</SelectValue></SelectTrigger></Select>
        <Input id="host-readonly" readOnly value="Read only" />
      </main>
      {createPortal(<aside style={{position:"fixed",left:1080,top:16,width:180}}>
        <Input id="portal-input" placeholder="Portal input" />
        <Textarea id="portal-textarea" placeholder="Portal textarea" />
        <Card id="host-card">Card</Card>
        <div id="host-panel" className="app-surface">Panel</div>
        <div id="host-muted-card" style={{background:"var(--surface-card-muted)"}}>Muted card</div>
      </aside>, document.body)}
      <main id="sdk-region" className="app-main" style={{inset:"16px auto auto 360px",width:700,height:740}}>
        <ExtensionCustomUi item={{package:{manifest:{id:"fixture.styles",name:"Style parity"},sha256:"fixture"},generation:1,grantedPermissions:[]}}
          commandId="open" view={{version:2,state:"{}",display:"Fixture",description:"",fields:[],groups:[]}}
          fields={{}} checkpoint={null} busy={false} dirty={false} execute={async () => null} />
      </main></>
    );
  `,
  );
  await build({
    configFile: false,
    root: temporary,
    logLevel: "warn",
    plugins: [react(), tailwind()],
    resolve: {
      alias: [
        { find: "@/lib/tauri", replacement: join(temporary, "native.ts") },
        {
          find: "@/providers/settings",
          replacement: join(temporary, "providers.ts"),
        },
        {
          find: "@/providers/i18n",
          replacement: join(temporary, "providers.ts"),
        },
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
    logLevel: "warn",
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
    window.parityThemeMessages = 0;
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message, ...arguments_) {
      if (message?.type === "state" && message.value?.theme)
        window.parityThemeMessages++;
      return post.call(this, message, ...arguments_);
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.locator("#host-button")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCSS("opacity", "1");
  const frame = page.frames().find((frame) => frame.parentFrame());
  await frame.evaluate(() => {
    document.querySelector("#sdk-indeterminate").indeterminate = true;
  });
  const sendTheme = async (dark, small = false) => {
    await page.evaluate(
      ({ dark, small }) => {
        const root = document.documentElement;
        root.classList.toggle("dark", dark);
        root.classList.toggle("light", !dark);
        root.dataset.accent = "indigo";
        root.dataset.radius = small ? "round" : "default";
        root.dataset.fontSize = small ? "sm" : "default";
        root.dataset.motion = "reduced";
      },
      { dark, small },
    );
    await expect(frame.locator("html")).toHaveClass(dark ? "dark" : "light");
    await expect(frame.locator("[data-starter-initial-paint]")).toHaveCount(0);
  };
  const measure = (locator, properties) =>
    locator.evaluate(async (node, properties) => {
      const style = getComputedStyle(node);
      // Read final colors, rather than a one-millisecond reduced-motion interpolation.
      void style.borderColor;
      await Promise.all(
        node
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => {})),
      );
      return Object.fromEntries(
        properties.map((name) => {
          if (["backgroundColor", "borderColor", "color"].includes(name)) {
            // Equivalent computed colors can serialize as oklab or oklch after a transition.
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d");
            context.fillStyle = style[name];
            context.fillRect(0, 0, 1, 1);
            return [name, Array.from(context.getImageData(0, 0, 1, 1).data)];
          }
          // CSS uses either 50% or a very large radius for the same circular shape.
          if (name === "borderRadius") {
            const bounds = node.getBoundingClientRect();
            return [
              name,
              style[name] === "50%"
                ? Math.min(bounds.width, bounds.height) / 2
                : Math.min(
                    parseFloat(style[name]),
                    bounds.width / 2,
                    bounds.height / 2,
                  ),
            ];
          }
          if (name === "boxShadow") {
            // Tailwind composes invisible placeholder shadows around the visible ring.
            const visible = style[name]
              .split(/,(?![^()]*\))/)
              .map((shadow) => shadow.trim())
              .filter(
                (shadow) => shadow !== "rgba(0, 0, 0, 0) 0px 0px 0px 0px",
              );
            return [name, visible.join(", ") || "none"];
          }
          return [name, style[name]];
        }),
      );
    }, properties);
  const compare = async (host, child, properties) => {
    const expected = await measure(page.locator(`#host-${host}`), properties);
    await expect
      .poll(
        () => measure(frame.locator(`#sdk-${child}`), properties),
        `${host} / ${child}`,
      )
      .toEqual(expected);
  };
  const checkSurfaceBackground = async (transparent) => {
    await page.locator("#sdk-region").evaluate((node) => {
      node.style.backgroundImage =
        "linear-gradient(90deg,#7c3aed 50%,#0891b2 50%)";
    });
    const bounds = await page.locator("iframe").boundingBox();
    assert.ok(bounds);
    const samples = [0.25, 0.75].map((fraction) => ({
      x: Math.floor(bounds.x + bounds.width * fraction),
      y: Math.floor(bounds.y + bounds.height - 20),
      width: 1,
      height: 1,
    }));
    const surface = page.locator("[data-extension-custom-ui]");
    await surface.evaluate((node) => (node.style.visibility = "hidden"));
    const expected = [];
    try {
      for (const clip of samples)
        expected.push(await page.screenshot({ clip }));
    } finally {
      await surface.evaluate((node) => node.style.removeProperty("visibility"));
    }
    // 比较实际合成像素，覆盖外壳、iframe 和文档画布，避免透明 CSS 仍被某层底色遮住。
    for (const [index, clip] of samples.entries()) {
      const actual = await page.screenshot({ clip });
      assert.equal(
        actual.equals(expected[index]),
        transparent,
        transparent
          ? "页面留白应透出宿主背景"
          : "作者设置的背景应继续覆盖宿主背景",
      );
    }
  };
  const buttonProperties = [
    "height",
    "borderRadius",
    "borderWidth",
    "backgroundColor",
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "lineHeight",
  ];
  const fieldProperties = [
    "height",
    "borderRadius",
    "borderColor",
    "backgroundColor",
    "fontSize",
    "lineHeight",
    "paddingLeft",
    "paddingTop",
  ];
  const checkProperties = [
    "width",
    "height",
    "borderRadius",
    "borderColor",
    "backgroundColor",
    "color",
  ];
  for (const dark of [false, true]) {
    await page.mouse.click(1200, 780);
    await sendTheme(dark, dark);
    await checkSurfaceBackground(true);
    for (const child of ["button", "input-button", "submit", "reset"])
      await compare("button", child, buttonProperties);
    for (const variant of [
      "secondary",
      "outline",
      "ghost",
      "destructive",
      "link",
    ]) {
      await compare(variant, variant, buttonProperties);
      await page.locator(`#host-${variant}`).hover();
      const hovered = await measure(page.locator(`#host-${variant}`), [
        "backgroundColor",
        "color",
      ]);
      await frame.locator(`#sdk-${variant}`).hover();
      await expect
        .poll(() =>
          measure(frame.locator(`#sdk-${variant}`), [
            "backgroundColor",
            "color",
          ]),
        )
        .toEqual(hovered);
    }
    await page.mouse.move(1200, 780);
    await compare("input", "input", fieldProperties);
    await compare("textarea", "textarea", fieldProperties);
    for (const field of ["input", "textarea", "select"])
      await compare(`${field}-disabled`, `${field}-disabled`, [
        "backgroundColor",
        "opacity",
      ]);
    await compare("readonly", "readonly", fieldProperties);
    for (const field of ["input", "textarea"])
      assert.deepEqual(
        await measure(page.locator(`#portal-${field}`), fieldProperties),
        await measure(page.locator(`#host-${field}`), fieldProperties),
        `${field} must keep its background outside app-main`,
      );
    await compare("select", "select", ["backgroundColor"]);
    await page.locator("#host-select").hover();
    const selectHover = await measure(page.locator("#host-select"), [
      "backgroundColor",
    ]);
    await frame.locator("#sdk-select").hover();
    await expect
      .poll(() => measure(frame.locator("#sdk-select"), ["backgroundColor"]))
      .toEqual(selectHover);
    await page.mouse.move(1200, 780);
    for (const exposure of [0, 0.5, 1]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.background = "aurora";
        document.documentElement.style.setProperty(
          "--skin-exposure",
          String(value),
        );
      }, exposure);
      for (const surface of ["card", "muted-card"])
        await compare(surface, surface, ["backgroundColor"]);
      assert.deepEqual(
        await measure(page.locator("#host-panel"), ["backgroundColor"]),
        await measure(page.locator("#host-card"), ["backgroundColor"]),
        "handwritten panels and Card must use the same surface",
      );
      const { backgroundColor } = await measure(page.locator("#host-card"), [
        "backgroundColor",
      ]);
      assert.equal(backgroundColor[3], Math.round(255 * (1 - exposure ** 4)));
      assert.equal(
        (await measure(page.locator("#host-input"), ["backgroundColor"]))
          .backgroundColor[3],
        255,
      );
    }
    for (const check of ["checkbox", "unchecked", "indeterminate", "radio"])
      await compare(check, check, checkProperties);
    await compare("disabled", "disabled", [
      "opacity",
      "pointerEvents",
      "backgroundColor",
    ]);
    await page.keyboard.press("Tab");
    for (const target of ["button", "input", "invalid", "checkbox"]) {
      await page.locator(`#host-${target}`).focus();
      const expected = await measure(page.locator(`#host-${target}`), [
        "borderColor",
        "boxShadow",
        "outlineStyle",
      ]);
      await frame.locator(`#sdk-${target}`).focus();
      await expect
        .poll(
          () =>
            measure(frame.locator(`#sdk-${target}`), [
              "borderColor",
              "boxShadow",
              "outlineStyle",
            ]),
          `focus ${target} / ${dark}`,
        )
        .toEqual(expected);
    }
    console.log(
      `PASS real host / SDK default controls: ${dark ? "dark, small font, round radius" : "light"}`,
    );
  }
  await sendTheme(false);
  await compare("input", "input", fieldProperties);
  const originalFrame = await page.locator("iframe").elementHandle();
  const themeMessages = () => page.evaluate(() => window.parityThemeMessages);
  const flushFrames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await flushFrames();
  const wideMessages = await themeMessages();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.locator("#sdk-region").evaluate((node) => {
    node.style.width = "500px";
  });
  await flushFrames();
  await compare("input", "input", fieldProperties);
  await compare("textarea", "textarea", fieldProperties);
  await expect(frame.locator("#sdk-input")).toHaveCSS("font-size", "14px");
  await expect(frame.locator("#sdk-button")).toHaveCSS("font-size", "14px");
  assert.equal(
    await themeMessages(),
    wideMessages,
    "resizing within the host breakpoint must not resend theme/font data",
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#sdk-region").evaluate((node) => {
    node.style.width = "300px";
  });
  await expect(frame.locator("#sdk-input")).toHaveCSS("font-size", "16px");
  await compare("input", "input", fieldProperties);
  await compare("textarea", "textarea", fieldProperties);
  await expect(frame.locator("#sdk-select")).toHaveCSS("font-size", "14px");
  await expect(frame.locator("#sdk-button")).toHaveCSS("font-size", "14px");
  await expect.poll(themeMessages).toBe(wideMessages + 1);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(frame.locator("#sdk-input")).toHaveCSS("font-size", "14px");
  await compare("input", "input", fieldProperties);
  await compare("textarea", "textarea", fieldProperties);
  await expect.poll(themeMessages).toBe(wideMessages + 2);
  assert.equal(await originalFrame.evaluate((node) => node.isConnected), true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("#sdk-region").evaluate((node) => {
    node.style.width = "700px";
  });
  console.log(
    "PASS production theme bridge: host 900px / narrow iframe, host 360px, bidirectional breakpoint resize and no theme resend within a breakpoint",
  );
  await frame.evaluate(() => {
    const root = document
      .querySelector("#shadow-host")
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<button id="shadow-button">Shadow</button><select aria-label="Choice"><option>One</option><option>Two</option></select>';
    window.shadowCleanup = starter.applyStyles(root);
  });
  const shadowButton = frame.locator("#shadow-host #shadow-button");
  await expect
    .poll(() => measure(shadowButton, buttonProperties))
    .toEqual(await measure(frame.locator("#sdk-button"), buttonProperties));
  const shadowSelect = frame.locator("#shadow-host select");
  await shadowSelect.click();
  await expect(
    frame.locator("#shadow-host [data-starter-listbox]"),
  ).toBeVisible();
  await shadowSelect.press("End");
  await shadowSelect.press("Enter");
  await expect(shadowSelect).toHaveValue("Two");
  await frame.addStyleTag({
    content:
      "#sdk-authored { height:44px; border-radius:3px; background:rgb(2, 3, 4); }",
  });
  await expect(frame.locator("#sdk-authored")).toHaveCSS("height", "44px");
  await expect(frame.locator("#sdk-authored")).toHaveCSS(
    "border-radius",
    "3px",
  );
  await expect(frame.locator("#sdk-authored")).toHaveCSS(
    "background-color",
    "rgb(2, 3, 4)",
  );
  await frame.evaluate(() => {
    window.shadowCleanup();
    window.shadowCleanup();
  });
  await expect(
    frame.locator("#shadow-host [data-starter-defaults]"),
  ).toHaveCount(0);
  await frame.locator("#sdk-checkbox").uncheck();
  await frame.locator("#sdk-checkbox").press("Space");
  await expect(frame.locator("#sdk-checkbox")).toBeChecked();
  await frame.locator("#sdk-range").focus();
  await frame.locator("#sdk-range").press("ArrowRight");
  await expect(frame.locator("#sdk-range")).toHaveValue("31");
  await page.emulateMedia({ contrast: "more" });
  await compare("card", "card", ["backgroundColor"]);
  assert.equal(
    (await measure(frame.locator("#sdk-card"), ["backgroundColor"]))
      .backgroundColor[3],
    255,
  );
  await page.emulateMedia({ contrast: "no-preference" });
  await compare("card", "card", ["backgroundColor"]);
  assert.equal(
    (await measure(frame.locator("#sdk-card"), ["backgroundColor"]))
      .backgroundColor[3],
    0,
  );
  await page.emulateMedia({ forcedColors: "active" });
  await compare("card", "card", ["backgroundColor"]);
  assert.equal(
    (await measure(frame.locator("#sdk-card"), ["backgroundColor"]))
      .backgroundColor[3],
    255,
  );
  for (const id of ["checkbox", "radio", "range"])
    await expect(frame.locator(`#sdk-${id}`)).toHaveCSS("appearance", "auto");
  console.log(
    "PASS shadow styles/select, author CSS overrides, native keyboard semantics and forced-colors fallback",
  );
  await page.emulateMedia({ forcedColors: "none" });
  await frame.evaluate(() => {
    document.body.style.cssText =
      "margin:0;padding:0;min-height:100vh;background:linear-gradient(120deg,#7c3aed,#0891b2)";
    const probe = document.createElement("div");
    probe.id = "sdk-width-probe";
    probe.style.cssText = "width:100%;height:120px;background:#7c3aed";
    document.body.replaceChildren(probe);
  });
  await expect(frame.locator("body")).toHaveCSS("padding", "0px");
  await checkSurfaceBackground(false);
  const documentLayout = () =>
    frame.evaluate(() => {
      const root = document.scrollingElement;
      return {
        right: document
          .querySelector("#sdk-width-probe")
          .getBoundingClientRect().right,
        width: innerWidth,
        height: innerHeight,
        contentHeight: root.scrollHeight,
        overflowX: root.scrollWidth > innerWidth,
        overflowY: root.scrollHeight > innerHeight,
        scrollTop: root.scrollTop,
      };
    });
  let layout = await documentLayout();
  assert.equal(
    layout.right,
    layout.width,
    "short authored content must reach the iframe edge without an empty scrollbar gutter",
  );
  assert.equal(layout.overflowX, false);
  assert.equal(layout.overflowY, false);
  const longHeight = await frame.evaluate(() => {
    const height = innerHeight * 2;
    document.querySelector("#sdk-width-probe").style.height = `${height}px`;
    return height;
  });
  await expect(frame.locator("#sdk-width-probe")).toHaveCSS(
    "height",
    `${longHeight}px`,
  );
  await frame.evaluate(() => window.scrollTo(0, 80));
  layout = await documentLayout();
  assert.equal(layout.overflowX, false);
  assert.equal(layout.overflowY, true, JSON.stringify(layout));
  assert.ok(
    layout.scrollTop > 0,
    "long content must retain document scrolling",
  );
  await frame.evaluate(() => {
    document.querySelector("#sdk-width-probe").style.height = "120px";
    window.scrollTo(0, 0);
  });
  await expect(frame.locator("#sdk-width-probe")).toHaveCSS("height", "120px");
  layout = await documentLayout();
  assert.equal(layout.right, layout.width);
  assert.equal(layout.overflowX, false);
  assert.equal(layout.overflowY, false);
  console.log(
    "PASS authored backgrounds fill short iframe documents and retain native scrolling for long content",
  );
} finally {
  await browser?.close();
  if (server)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  // Only the fresh test directory inside this repository cache is removed.
  assert.ok(
    resolve(temporary).startsWith(`${resolve(cache)}\\`) ||
      resolve(temporary).startsWith(`${resolve(cache)}/`),
  );
  await rm(temporary, { recursive: true });
}

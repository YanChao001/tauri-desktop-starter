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
      <span id="sdk-badge-destructive" class="ui-badge ui-badge-destructive">Destructive badge</span>
      <a id="sdk-badge-link-destructive" href="#badge" class="ui-badge ui-badge-destructive">Destructive badge link</a>
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
      <input id="sdk-switch" type="checkbox" role="switch">
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
    import { Badge } from ${sourcePath("src/components/ui/badge.tsx")};
    import { Input } from ${sourcePath("src/components/ui/input.tsx")};
    import { Textarea } from ${sourcePath("src/components/ui/textarea.tsx")};
    import { Select, SelectTrigger, SelectValue } from ${sourcePath("src/components/ui/select.tsx")};
    import { Checkbox } from ${sourcePath("src/components/ui/checkbox.tsx")};
    import { Switch } from ${sourcePath("src/components/ui/switch.tsx")};
    import { RadioGroup, RadioGroupItem } from ${sourcePath("src/components/ui/radio-group.tsx")};
    import { Tabs, TabsList, TabsTrigger } from ${sourcePath("src/components/ui/tabs.tsx")};
    import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from ${sourcePath("src/components/ui/dialog.tsx")};
    import { ExtensionCustomUi } from ${sourcePath("src/features/extensions/extension-custom-ui.tsx")};
    import { applySettings, DEFAULT_SETTINGS, type Accent } from ${sourcePath("src/lib/settings-model.ts")};
    import "./fixture.css";
    window.parityApplyAccent = (accent: Accent, customAccent: string, theme: "light" | "dark") =>
      applySettings({ ...DEFAULT_SETTINGS, accent, customAccent, theme, motion: "reduced" });
    function HostDialogProbe() {
      return <Dialog>
        <DialogTrigger asChild><Button id="host-dialog-open">Open dialog</Button></DialogTrigger>
        <DialogContent id="host-dialog" closeLabel="Close">
          <DialogHeader><DialogTitle>Dialog material</DialogTitle><DialogDescription>Shared modal reading surface</DialogDescription></DialogHeader>
        </DialogContent>
      </Dialog>;
    }
    createRoot(document.getElementById("root")!).render(
      <><main className="app-main" style={{inset:"16px auto auto 16px",width:320,display:"grid",gap:12}}>
        <Button id="host-button">Button</Button>
        <Button id="host-secondary" variant="secondary">Secondary</Button>
        <Button id="host-outline" variant="outline">Outline</Button>
        <Button id="host-ghost" variant="ghost">Ghost</Button>
        <Button id="host-destructive" variant="destructive">Destructive</Button>
        <Badge id="host-badge-destructive" variant="destructive">Destructive badge</Badge>
        <Badge id="host-badge-link-destructive" variant="destructive" asChild><a href="#badge">Destructive badge link</a></Badge>
        <Button id="host-link" variant="link">Link</Button>
        <Button id="host-disabled" disabled>Disabled</Button>
        <Input id="host-input" placeholder="Input" />
        <Input id="host-invalid" aria-invalid="true" />
        <Textarea id="host-textarea" placeholder="Textarea" />
        <Checkbox id="host-checkbox" defaultChecked />
        <Checkbox id="host-unchecked" />
        <Switch id="host-switch" />
        <Checkbox id="host-indeterminate" checked="indeterminate" />
        <RadioGroup defaultValue="one"><RadioGroupItem id="host-radio" value="one" /></RadioGroup>
        <Select defaultValue="one"><SelectTrigger id="host-select"><SelectValue>Select</SelectValue></SelectTrigger></Select>
        <Input id="host-input-disabled" disabled value="Disabled input" />
        <Textarea id="host-textarea-disabled" disabled value="Disabled textarea" />
        <Select defaultValue="one" disabled><SelectTrigger id="host-select-disabled"><SelectValue>Disabled select</SelectValue></SelectTrigger></Select>
        <Input id="host-readonly" readOnly value="Read only" />
        <Tabs defaultValue="one"><TabsList variant="line"><TabsTrigger id="host-line-one" value="one">Line one</TabsTrigger><TabsTrigger value="two">Line two</TabsTrigger></TabsList></Tabs>
      </main>
      {createPortal(<aside style={{position:"fixed",left:1080,top:16,width:180}}>
        <HostDialogProbe />
        <Input id="portal-input" placeholder="Portal input" />
        <Textarea id="portal-textarea" placeholder="Portal textarea" />
        <Card id="host-card">Card</Card>
        <div id="host-border-reference" className="border" style={{boxShadow:"0 0 0 1px var(--surface-frame-border)"}}>Border reference</div>
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
  const measure = (locator, properties, pseudo = null) =>
    locator.evaluate(
      async (node, { properties, pseudo }) => {
        const style = getComputedStyle(node, pseudo);
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
            if (
              [
                "backgroundColor",
                "borderColor",
                "color",
                "placeholderColor",
                "--input",
                "--border",
              ].includes(name)
            ) {
              // Equivalent computed colors can serialize as oklab or oklch after a transition.
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d");
              context.fillStyle =
                name === "placeholderColor"
                  ? getComputedStyle(node, "::placeholder").color
                  : name.startsWith("--")
                    ? style.getPropertyValue(name)
                    : style[name];
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
      },
      { properties, pseudo },
    );
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
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const expected = [];
    try {
      for (const clip of samples)
        expected.push(await page.screenshot({ clip }));
    } finally {
      await surface.evaluate((node) => node.style.removeProperty("visibility"));
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    }
    // 比较实际合成像素，覆盖外壳、iframe 和文档画布，避免透明 CSS 仍被某层底色遮住。
    // 控件多少和是否后来新增不应改变“文档画布背景”的采样位置。
    const hideContents = await frame.addStyleTag({
      content:
        "body > :not(style):not(script) { visibility:hidden !important; }",
    });
    try {
      await frame.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
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
    } finally {
      await hideContents.evaluate((node) => node.remove());
      await frame.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    }
  };
  const buttonProperties = [
    "height",
    "borderRadius",
    "borderWidth",
    "backgroundColor",
    "backdropFilter",
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
  // 首个主题就绪后才出现的控件也必须自动获得完整规则，而不是按已有 DOM 裁剪样式。
  const addRareControls = (prefix) => {
    const section = document.createElement("section");
    section.innerHTML = `
      <fieldset id="${prefix}-rare-fieldset"><legend>Rare controls</legend>
        <input id="${prefix}-rare-date" type="date" value="2026-10-29">
        <input id="${prefix}-rare-time" type="time" value="12:30">
        <input id="${prefix}-rare-color" type="color" value="#336699">
        <input id="${prefix}-rare-file" type="file">
        <select id="${prefix}-rare-multiple" multiple size="3"><option>One</option><option>Two</option><option>Three</option></select>
      </fieldset>
      <output id="${prefix}-rare-output">Result</output>
      <pre id="${prefix}-rare-pre"><code><span class="code-token--property">name</span></code></pre>
      <details id="${prefix}-rare-details" open style="--disclosure-radius:calc(var(--radius) * 1.4)"><summary id="${prefix}-rare-summary">Details</summary>Details content</details>
      <kbd id="${prefix}-rare-kbd">Ctrl K</kbd>
      <kbd id="${prefix}-rare-kbd-control" data-surface="control">Ctrl K</kbd>
      <table><thead id="${prefix}-rare-header"><tr><th>Column</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>
      <progress id="${prefix}-rare-progress" value="60" max="100"></progress>
      <meter id="${prefix}-rare-meter" value="0.6"></meter>
      <dialog id="${prefix}-rare-dialog"><form method="dialog"><p>Native dialog</p><button>Close native dialog</button></form></dialog>`;
    (document.querySelector("main") || document.body).append(section);
  };
  await page.evaluate(addRareControls, "host");
  await frame.evaluate(addRareControls, "sdk");
  const rareControls = [
    "fieldset",
    "date",
    "time",
    "color",
    "file",
    "multiple",
    "output",
    "pre",
    "summary",
    "kbd",
    "kbd-control",
    "header",
    "progress",
    "meter",
  ];
  const rareProperties = [
    "backgroundColor",
    "color",
    "borderColor",
    "borderRadius",
    "backdropFilter",
    "fontFamily",
  ];
  const configuredAlpha = (kind, exposure) =>
    page.evaluate(
      ({ kind, exposure }) => {
        if (exposure === 0) return 255;
        const point = exposure === 0.5 ? "half" : "full";
        return Math.round(
          (255 *
            parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue(
                `--ui-${kind}-opacity-at-${point}`,
              ),
            )) /
            100,
        );
      },
      { kind, exposure },
    );
  const dialogProperties = ["backgroundColor", "color", "backdropFilter"];
  const backdropProperties = ["backgroundColor", "backdropFilter"];
  const dialogRecipe = async () => {
    await page.locator("#host-dialog-open").click();
    const panel = page.locator("#host-dialog");
    await expect(panel).toHaveCSS("opacity", "1");
    const recipe = {
      panel: await measure(panel, dialogProperties),
      backdrop: await measure(
        page.locator('[data-slot="dialog-overlay"]'),
        backdropProperties,
      ),
    };
    for (const surface of [recipe.panel, recipe.backdrop]) {
      assert.ok(
        surface.backgroundColor[3] > 0 && surface.backgroundColor[3] < 255,
        "modal panel and scrim retain translucent reading masks",
      );
      assert.ok(
        parseFloat(surface.backdropFilter.match(/[\d.]+/)?.[0] ?? "0") > 0,
        "modal panel and scrim retain local backdrop blur",
      );
    }
    await panel.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator("#host-dialog-open")).toBeFocused();
    return recipe;
  };
  const checkNativeDialog = async (dialog, recipe, label) => {
    await dialog.evaluate((node) => node.showModal());
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => measure(dialog, dialogProperties), `${label} panel`)
      .toEqual(recipe.panel);
    await expect
      .poll(
        () => measure(dialog, backdropProperties, "::backdrop"),
        `${label} native backdrop`,
      )
      .toEqual(recipe.backdrop);
    await dialog.locator("button").press("Escape");
    await expect(dialog).toBeHidden();
    assert.equal(
      await dialog.evaluate((node) => node.open),
      false,
      "Escape closes native dialogs without replacing browser keyboard semantics",
    );
  };
  const checkDisclosure = async (scope, prefix) => {
    const details = scope.locator(`#${prefix}-rare-details`);
    const summary = scope.locator(`#${prefix}-rare-summary`);
    assert.equal(await details.evaluate((node) => node.open), true);
    await summary.focus();
    for (const open of [false, true]) {
      await summary.press("Enter");
      await expect.poll(() => details.evaluate((node) => node.open)).toBe(open);
      await expect(summary).toBeFocused();
      const radii = await summary.evaluate((node) => {
        const corners = [
          "borderTopLeftRadius",
          "borderTopRightRadius",
          "borderBottomRightRadius",
          "borderBottomLeftRadius",
        ];
        const read = (element) =>
          corners.map((corner) =>
            parseFloat(getComputedStyle(element)[corner]),
          );
        return { parent: read(node.closest("details")), summary: read(node) };
      });
      assert.ok(
        radii.parent.every((radius) => radius > 0),
        "disclosure container retains its configured rounded corners",
      );
      await expect
        .poll(
          () =>
            summary.evaluate((node) => {
              const style = getComputedStyle(node);
              return [
                style.borderTopLeftRadius,
                style.borderTopRightRadius,
                style.borderBottomRightRadius,
                style.borderBottomLeftRadius,
              ].map(parseFloat);
            }),
          `${prefix} summary uses the parent's explicit disclosure radius in ${open ? "open" : "closed"} state`,
        )
        .toEqual(
          open ? [radii.parent[0], radii.parent[1], 0, 0] : radii.parent,
        );
    }
  };
  const checkSoftDanger = async (locator, opacity) => {
    const paint = await measure(locator, [
      "backgroundColor",
      "color",
      "backdropFilter",
    ]);
    assert.ok(
      Math.abs(paint.backgroundColor[3] - 255 * opacity) <= 1,
      "destructive controls retain their original low-alpha tint",
    );
    assert.equal(
      paint.backdropFilter,
      "none",
      "soft semantic danger tints do not add another glass layer",
    );
    return paint;
  };
  for (const dark of [false, true]) {
    await page.mouse.click(1200, 780);
    await sendTheme(dark, dark);
    await checkSurfaceBackground(true);
    const dangerOpacity = dark ? 0.1 : 0.05;
    const dangerHoverOpacity = dark ? 0.2 : 0.1;
    const semanticBorders = await measure(page.locator("html"), [
      "--input",
      "--border",
    ]);
    for (const kind of ["input", "outline", "textarea", "select"]) {
      assert.deepEqual(
        await measure(page.locator(`#host-${kind}`), [
          "borderWidth",
          "borderColor",
        ]),
        {
          borderWidth: "1px",
          borderColor: semanticBorders["--input"],
        },
        `${kind} retains its original thin input border`,
      );
    }
    assert.deepEqual(
      await measure(page.locator("#host-border-reference"), [
        "borderWidth",
        "borderColor",
      ]),
      {
        borderWidth: "1px",
        borderColor: semanticBorders["--border"],
      },
      "ordinary borders retain the theme border color instead of a foreground-strengthened outline",
    );
    const cardFrame = await measure(page.locator("#host-card"), ["boxShadow"]);
    assert.match(cardFrame.boxShadow, / 0px 0px 0px 1px$/);
    assert.deepEqual(
      cardFrame,
      await measure(page.locator("#host-border-reference"), ["boxShadow"]),
      "Card retains a single one-pixel outer frame",
    );
    const switchBorder = await measure(page.locator("#host-switch"), [
      "borderWidth",
      "borderColor",
    ]);
    assert.equal(switchBorder.borderWidth, "1px");
    assert.equal(
      switchBorder.borderColor[3],
      0,
      "unselected switches retain a transparent layout border",
    );
    await compare("switch", "switch", ["borderWidth", "borderColor"]);
    for (const kind of ["progress", "meter"])
      await expect(page.locator(`#host-rare-${kind}`)).toHaveCSS(
        "border-width",
        "0px",
      );
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
      if (variant === "destructive") {
        await checkSoftDanger(page.locator("#host-destructive"), dangerOpacity);
        await checkSoftDanger(frame.locator("#sdk-destructive"), dangerOpacity);
      }
      await page.locator(`#host-${variant}`).hover();
      const hovered = await measure(page.locator(`#host-${variant}`), [
        "backgroundColor",
        "color",
      ]);
      if (variant === "destructive")
        await checkSoftDanger(
          page.locator("#host-destructive"),
          dangerHoverOpacity,
        );
      await frame.locator(`#sdk-${variant}`).hover();
      await expect
        .poll(() =>
          measure(frame.locator(`#sdk-${variant}`), [
            "backgroundColor",
            "color",
          ]),
        )
        .toEqual(hovered);
      if (variant === "destructive") {
        await checkSoftDanger(
          frame.locator("#sdk-destructive"),
          dangerHoverOpacity,
        );
      }
    }
    for (const kind of ["badge-destructive", "badge-link-destructive"]) {
      await page.mouse.move(1200, 780);
      await compare(kind, kind, ["backgroundColor", "color", "backdropFilter"]);
      await checkSoftDanger(page.locator(`#host-${kind}`), dangerOpacity);
      await checkSoftDanger(frame.locator(`#sdk-${kind}`), dangerOpacity);
      const hoveredOpacity =
        kind === "badge-link-destructive" ? dangerHoverOpacity : dangerOpacity;
      await page.locator(`#host-${kind}`).hover();
      const expected = await checkSoftDanger(
        page.locator(`#host-${kind}`),
        hoveredOpacity,
      );
      await frame.locator(`#sdk-${kind}`).hover();
      await expect
        .poll(() =>
          measure(frame.locator(`#sdk-${kind}`), [
            "backgroundColor",
            "color",
            "backdropFilter",
          ]),
        )
        .toEqual(expected);
      await checkSoftDanger(frame.locator(`#sdk-${kind}`), hoveredOpacity);
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
    for (const exposure of [0, 0.1, 0.3, 0.5, 0.7, 1]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.background = "aurora";
        document.documentElement.dataset.backgroundIntensity = String(
          value * 100,
        );
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
      const fieldAlpha = (
        await measure(page.locator("#host-input"), ["backgroundColor"])
      ).backgroundColor[3];
      if ([0, 0.5, 1].includes(exposure)) {
        assert.ok(
          Math.abs(
            backgroundColor[3] - (await configuredAlpha("panel", exposure)),
          ) <= 1,
          `configured panel at ${exposure}`,
        );
        assert.ok(
          Math.abs(fieldAlpha - (await configuredAlpha("control", exposure))) <=
            1,
          `configured input at ${exposure}`,
        );
      }
      await compare("input", "input", [
        "backgroundColor",
        "backdropFilter",
        "placeholderColor",
      ]);
      await compare("textarea", "textarea", [
        "backgroundColor",
        "backdropFilter",
        "placeholderColor",
      ]);
      await compare("select", "select", ["backgroundColor", "backdropFilter"]);
      if ([0.5, 1].includes(exposure)) {
        for (const control of rareControls)
          await compare(`rare-${control}`, `rare-${control}`, rareProperties);
        const explicit = await measure(frame.locator("#sdk-rare-kbd-control"), [
          "backgroundColor",
        ]);
        assert.ok(
          Math.abs(
            explicit.backgroundColor[3] -
              (await configuredAlpha("control", exposure)),
          ) <= 1,
          "explicit material overrides the native element default",
        );
        assert.ok(
          await frame
            .locator("#sdk-rare-multiple")
            .evaluate(
              (node) =>
                parseFloat(getComputedStyle(node).height) >=
                4 *
                  parseFloat(
                    getComputedStyle(document.documentElement).fontSize,
                  ),
            ),
          "multi-select retains multiple rows at the host font size",
        );
        const recipe = await dialogRecipe();
        await checkNativeDialog(
          page.locator("#host-rare-dialog"),
          recipe,
          `host ${dark ? "dark" : "light"} ${exposure}`,
        );
        await checkNativeDialog(
          frame.locator("#sdk-rare-dialog"),
          recipe,
          `SDK ${dark ? "dark" : "light"} ${exposure}`,
        );
      }
    }
    await checkDisclosure(page, "host");
    await checkDisclosure(frame, "sdk");
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
    const marker = await page.locator("#host-line-one").evaluate((node) => {
      const after = getComputedStyle(node, "::after");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      const rgba = (color) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      return {
        opacity: after.opacity,
        width: parseFloat(after.width),
        height: parseFloat(after.height),
        background: rgba(after.backgroundColor),
        foreground: rgba(getComputedStyle(node).color),
      };
    });
    assert.equal(
      marker.opacity,
      "1",
      "selected line tab keeps its visible marker",
    );
    assert.ok(
      marker.width > 0 && marker.height > 0,
      "line marker retains real host geometry",
    );
    assert.deepEqual(
      marker.background,
      marker.foreground,
      "line marker uses the shared foreground paint",
    );
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
  const retainedFrame = await page.locator("iframe").elementHandle();
  const priorAccentAttributes = await page
    .locator("html")
    .evaluate((node) =>
      Object.fromEntries(
        node.getAttributeNames().map((name) => [name, node.getAttribute(name)]),
      ),
    );
  for (const [accent, customAccent, theme] of [
    ["custom", "#FFFFFF", "light"],
    ["custom", "#000000", "dark"],
    ["custom", "#00FFAA", "light"],
    ["custom", "#00FFAA", "dark"],
    ["blue", "#00FFAA", "light"],
  ]) {
    await page.evaluate(
      ({ accent, customAccent, theme }) =>
        window.parityApplyAccent(accent, customAccent, theme),
      { accent, customAccent, theme },
    );
    await expect(frame.locator("html")).toHaveClass(theme);
    await expect
      .poll(() => measure(frame.locator("#sdk-button"), buttonProperties))
      .toEqual(await measure(page.locator("#host-button"), buttonProperties));
    const customTokens = await page.locator("html").evaluate((node) => {
      const styles = getComputedStyle(node);
      return ["--custom-accent-light", "--custom-accent-dark"].map((name) =>
        styles.getPropertyValue(name).trim(),
      );
    });
    await expect
      .poll(() =>
        frame.locator("html").evaluate((node) => {
          const styles = getComputedStyle(node);
          return ["--custom-accent-light", "--custom-accent-dark"].map((name) =>
            styles.getPropertyValue(name).trim(),
          );
        }),
      )
      .toEqual(customTokens);
    assert.ok(await retainedFrame.evaluate((node) => node.isConnected));
  }
  console.log(
    "PASS custom accent colors and light/dark variants reach the existing SDK frame and restore presets",
  );
  await page.locator("html").evaluate((node, attributes) => {
    for (const name of node.getAttributeNames())
      if (!Object.hasOwn(attributes, name)) node.removeAttribute(name);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
  }, priorAccentAttributes);
  await frame.evaluate(() => {
    const root = document
      .querySelector("#shadow-host")
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<button id="shadow-button">Shadow</button><select aria-label="Choice"><option>One</option><option>Two</option></select><dialog id="shadow-dialog"><form method="dialog"><p>Shadow dialog</p><button>Close shadow dialog</button></form></dialog>';
    window.shadowCleanup = starter.applyStyles(root);
    // 接入样式后才插入未曾使用的标准控件，无需第二次 applyStyles。
    const later = document.createElement("div");
    later.innerHTML =
      '<meter id="shadow-meter" value="0.6"></meter><output id="shadow-output">Result</output><kbd id="shadow-kbd">Ctrl K</kbd>';
    root.append(later);
  });
  const shadowButton = frame.locator("#shadow-host #shadow-button");
  await expect
    .poll(() => measure(shadowButton, buttonProperties))
    .toEqual(await measure(frame.locator("#sdk-button"), buttonProperties));
  for (const dark of [false, true]) {
    await sendTheme(dark);
    for (const kind of ["meter", "output", "kbd"])
      await expect
        .poll(() =>
          measure(
            frame.locator(`#shadow-host #shadow-${kind}`),
            rareProperties,
          ),
        )
        .toEqual(
          await measure(page.locator(`#host-rare-${kind}`), rareProperties),
        );
    await checkNativeDialog(
      frame.locator("#shadow-host #shadow-dialog"),
      await dialogRecipe(),
      `ShadowRoot ${dark ? "dark" : "light"}`,
    );
  }
  await sendTheme(false);
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
    await configuredAlpha("panel", 1),
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

/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import appConfig from "../../app.config.json" with { type: "json" };

const KEY = `${appConfig.browserStorageNamespace}:settings`;

test("settings search opens over the page without moving settings or stealing input focus", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/settings");
  const target = page.locator("#settings-theme");
  const layout = () =>
    target.evaluate((element) => ({
      top:
        element.getBoundingClientRect().top +
        (element.closest("main")?.scrollTop ?? 0),
      height: element.getBoundingClientRect().height,
    }));
  const before = await layout();
  const search = page.getByRole("searchbox", {
    name: "Search settings",
    exact: true,
  });
  await search.fill("font");
  await expect(
    page.getByRole("dialog", { name: "Search settings", exact: true }),
  ).toBeVisible();
  await expect(search).toBeFocused();
  expect(await layout()).toEqual(before);
  await search.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Search settings", exact: true }),
  ).toHaveCount(0);
  expect(await layout()).toEqual(before);
});
const routes = [
  "/",
  "/catalog",
  "/components",
  "/motion",
  "/workbench",
  "/tasks",
  "/system",
  "/extensions",
  "/network",
  "/data-studio",
  "/media",
  "/desktop",
  "/database",
  "/bridge",
  "/diagnostics",
  "/updates",
  "/recovery",
  "/settings",
];
async function seed(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            schemaVersion: 3,
            language: "en",
            theme: "light",
            motion: "reduced",
            ...value,
          }),
        );
    },
    { key: KEY, value: settings },
  );
}

for (const theme of ["light", "dark"]) {
  test(
    "controls keep readable normal, hover and mixed states across accents: " +
      theme,
    async ({ page }) => {
      await seed(page, { theme, background: "plain" });
      await page.goto("./#/components");
      await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
      const primary = page.getByRole("button", {
        name: "Remix the idea",
        exact: true,
      });
      const all = page.getByRole("checkbox", {
        name: "Select all sample items",
      });
      await expect(all).toHaveAttribute("aria-checked", "mixed");
      await expect(all.locator(".lucide-minus")).toBeVisible();
      await expect(all.locator(".lucide-check")).toBeHidden();
      for (const accent of [
        "neutral",
        "indigo",
        "blue",
        "emerald",
        "amber",
        "rose",
        "violet",
      ]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.accent = value;
        }, accent);
        for (const hover of [false, true]) {
          if (hover) await primary.hover();
          else await page.mouse.move(0, 0);
          const ratio = await primary.evaluate((element) => {
            const style = getComputedStyle(element);
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            const luminance = (color: string) => {
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .reduce((sum, value, index) => {
                  const channel = value / 255;
                  return (
                    sum +
                    (channel <= 0.04045
                      ? channel / 12.92
                      : ((channel + 0.055) / 1.055) ** 2.4) *
                      [0.2126, 0.7152, 0.0722][index]!
                  );
                }, 0);
            };
            const text = luminance(style.color);
            const background = luminance(style.backgroundColor);
            return (
              (Math.max(text, background) + 0.05) /
              (Math.min(text, background) + 0.05)
            );
          });
          expect(
            ratio,
            `${theme} ${accent} hover=${hover}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        const colors = await all.evaluate((element) => ({
          mixed: getComputedStyle(element).backgroundColor,
          checked: getComputedStyle(
            document
              .querySelector("#reference-title")!
              .closest(".control-states")!
              .querySelector('[aria-checked="true"]')!,
          ).backgroundColor,
        }));
        expect(colors.mixed).toBe(colors.checked);
      }
      const title = page.getByRole("textbox", {
        name: "Sample title (required)",
      });
      await page
        .getByRole("button", { name: "Check input", exact: true })
        .click();
      await expect(title).toHaveAttribute("aria-invalid", "true");
      await title.fill("A local draft");
      await page
        .getByRole("button", { name: "Check input", exact: true })
        .click();
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: "Check passed" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Buttons & badges", exact: true })
        .click();
      const warning = page.getByRole("button", {
        name: "Warning",
        exact: true,
      });
      for (const hover of [false, true]) {
        if (hover) await warning.hover();
        else await page.mouse.move(0, 0);
        const scan = await new AxeBuilder({ page })
          .include(".playground-reference")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(scan.violations, `${theme} warning hover=${hover}`).toEqual([]);
      }
    },
  );

  test(
    "all routes pass the automated WCAG scan with a tinted theme: " + theme,
    async ({ page }) => {
      test.setTimeout(120_000);
      await seed(page, { theme, accent: "violet", background: "plain" });
      for (const route of routes) {
        await page.goto("./#" + route);
        if (route === "/desktop") {
          await expect(page).toHaveURL(/#\/settings\?section=desktop$/);
          await expect(page.locator("#settings-desktop")).toBeVisible();
          await expect(page.locator('nav a[href="#/desktop"]')).toHaveCount(0);
        }
        if (route === "/updates") {
          await expect(page).toHaveURL(/#\/settings\?section=updates$/);
          await expect(page.locator("#settings-updates")).toBeVisible();
          await expect(page.locator('nav a[href="#/updates"]')).toHaveCount(0);
        }
        await expect(page.locator("main h2").first()).toBeVisible();
        const result = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(result.violations, theme + " " + route).toEqual([]);
        if (route === "/components") {
          for (const stage of ["Overlays & feedback", "Resource collection"]) {
            await page.getByRole("tab", { name: new RegExp(stage) }).click();
            const scene = await new AxeBuilder({ page })
              .include("main")
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze();
            expect(scene.violations, theme + " " + stage).toEqual([]);
          }
        }
      }
    },
  );
}

test("the browser fills the viewport with the desktop and keeps narrow navigation in its title bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await seed(page);
  await page.goto("./#/settings");
  await expect(page.locator("main h2")).toBeVisible();
  await expect(
    page.locator(".browser-demo-bar, .browser-preview-badge"),
  ).toHaveCount(0);
  const chrome = await page.locator(".app-chrome").boundingBox();
  expect(chrome?.y).toBe(0);
  expect(chrome?.height).toBe(40);
  await expect(page.locator(".app-shell")).toHaveCSS("height", "820px");
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = page.locator(".app-title-bar .app-compact-navigation");
  await expect(navigation).toBeVisible();
  await navigation.click();
  await page
    .getByRole("option", { name: "App communication", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/bridge$/);
  expect((await page.locator(".app-chrome").boundingBox())?.height).toBe(40);
});

for (const language of ["en", "zh"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`shared dropdowns and title bar tooltips: ${language} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1120, height: 740 });
      await seed(page, { language, theme });
      await page.goto("./#/catalog");
      const chinese = language === "zh";
      const filter = page.getByRole("combobox", {
        name: chinese ? "使用条件" : "Requirements",
        exact: true,
      });
      await filter.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await expect(page.getByRole("option")).toHaveCount(4);
      await page.screenshot({ path: test.info().outputPath("dropdown.png") });
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("option", {
          name: chinese ? "全部功能" : "All features",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("option", {
          name: chinese ? "浏览器可体验" : "Try in the browser",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(filter).toContainText(
        chinese ? "浏览器可体验" : "Try in the browser",
      );
      await expect(filter).toBeFocused();
      await expect(
        page.locator('main [data-slot="card-title"]').filter({
          hasText: chinese ? /^应用通信$/ : /^App communication$/,
        }),
      ).toHaveCount(0);
      await filter.click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toBeHidden();
      await expect(filter).toBeFocused();

      const bar = page.locator(".app-title-bar");
      const search = bar.getByRole("button", {
        name: chinese ? "打开快速操作" : "Open quick actions",
      });
      const languageSwitch = bar.getByRole("combobox", {
        name: chinese ? "语言" : "Language",
      });
      const tooltip = page.locator('[data-slot="tooltip-content"]');
      for (const trigger of [search, languageSwitch]) {
        await expect(trigger).not.toHaveAttribute("title");
      }
      const appearance = () =>
        tooltip.evaluate((element) => {
          const style = getComputedStyle(element);
          return [
            style.backgroundColor,
            style.color,
            style.borderRadius,
            style.fontSize,
            style.padding,
          ];
        });
      await search.hover();
      await expect(tooltip).toContainText(
        chinese ? "打开快速操作" : "Open quick actions",
      );
      await expect(tooltip).toHaveAttribute("data-side", "bottom");
      const searchStyle = await appearance();
      await page.mouse.move(700, 140);
      await expect(tooltip).toBeHidden();
      await languageSwitch.hover();
      await expect(tooltip).toContainText(chinese ? "简体中文" : "English");
      await expect(tooltip).toHaveAttribute("data-side", "bottom");
      expect(await appearance()).toEqual(searchStyle);
      await languageSwitch.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await expect(tooltip).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(languageSwitch).toBeFocused();
    });
  }
}

test("shared selects retain form validation, disabled choices and pagination", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/network");
  await page.getByRole("combobox", { name: "Request source" }).click();
  await expect(
    page.getByRole("option", { name: "Online test" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.goto("./#/data-studio");
  await page.getByRole("combobox", { name: "Rows per page" }).click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(51);
  await page
    .getByRole("tab", { name: "Conditional form", exact: true })
    .click();
  const kind = page.getByRole("combobox", { name: "Request type" });
  await kind.click();
  await page.getByRole("option", { name: "Business", exact: true }).click();
  await expect(page.getByLabel("Company name", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit demo request" }).click();
  await expect(
    page.getByLabel("Company name", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#order-company-error")).toContainText(
    "Business requests require a company name",
  );
  await kind.click();
  await page.getByRole("option", { name: "Personal", exact: true }).click();
  await expect(page.getByLabel("Company name", { exact: true })).toHaveCount(0);
  await expect(page.locator("#order-company-error")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  for (const [language, keyword, source] of [
    ["rust", "pub", "pub fn greet"],
    ["typescript", "export", 'invokeGreet("Ada", language)'],
  ] as const) {
    test(
      "the displayed " +
        language +
        " IPC example has real syntax colors: " +
        theme,
      async ({ page }) => {
        await seed(page, { theme });
        await page.goto("./#/bridge");
        await page.getByText("Developer resources", { exact: true }).click();
        const code = page.locator('code[data-language="' + language + '"]');
        await expect(code).toContainText(source);
        await expect(code.locator('[data-token="keyword"]').first()).toHaveText(
          keyword,
        );
        const colors = await code.evaluate((element) => ({
          text: getComputedStyle(element).color,
          keyword: getComputedStyle(
            element.querySelector('[data-token="keyword"]')!,
          ).color,
        }));
        expect(colors.keyword).not.toBe(colors.text);
      },
    );
  }
}

for (const language of ["en", "zh"] as const) {
  test(`catalog document links open separate tabs and preserve the app: ${language}`, async ({
    page,
    context,
  }) => {
    await seed(page, {
      language,
      theme: language === "zh" ? "dark" : "light",
    });
    await page.goto("./#/catalog");
    await context.route(
      (url) => url.protocol === "https:",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Document</title>",
        }),
    );
    const appUrl = page.url();
    await page
      .getByText(language === "zh" ? "开发者资料" : "Developer resources", {
        exact: true,
      })
      .click();
    const links: readonly (readonly [string, string])[] =
      language === "zh"
        ? [
            ["开发指南", "development.md"],
            ["架构与边界", "architecture.md"],
            ["验证范围", "testing.md"],
          ]
        : [
            ["Development guide", "development.md"],
            ["Architecture & boundaries", "architecture.md"],
            ["Validation scope", "testing.md"],
          ];
    for (const [label, file] of links) {
      const link = page.getByRole("link", { name: label, exact: true });
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`/blob/develop/docs/${file.replace(".", "\\.")}$`),
      );
      const href = await link.getAttribute("href");
      if (!href) throw new Error("Document link has no URL");
      const opened = context.waitForEvent("page");
      if (file === "testing.md") {
        await link.focus();
        await link.press("Enter");
      } else {
        await link.click();
      }
      const popup = await opened;
      await expect(popup).toHaveURL(href);
      await popup.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(appUrl);
      await popup.close();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  const language = theme === "light" ? "zh" : "en";
  test(`catalog tutorial highlights both languages: ${language}, ${theme}`, async ({
    page,
  }, testInfo) => {
    await seed(page, { theme, language });
    await page.goto("./#/catalog");
    await expect(page.locator('code[data-language="rust"]')).toBeHidden();
    const developerResources = page.getByText(
      language === "zh" ? "开发者资料" : "Developer resources",
      { exact: true },
    );
    await developerResources.focus();
    await page.keyboard.press("Enter");
    for (const [grammar, name] of [
      ["rust", "lab_echo"],
      ["typescript", "labEcho"],
    ] as const) {
      const code = page.locator(`code[data-language="${grammar}"]`);
      await expect(code).toContainText(name);
      await expect(code.locator('[data-token="function"]').first()).toHaveText(
        name,
      );
      const colors = await code.evaluate((element) => ({
        text: getComputedStyle(element).color,
        keyword: getComputedStyle(
          element.querySelector('[data-token="keyword"]')!,
        ).color,
      }));
      expect(colors.keyword).not.toBe(colors.text);
      const source = await code.textContent();
      const selected = await code.evaluate((element) => {
        const selection = window.getSelection()!;
        selection.selectAllChildren(element);
        const text = selection.toString();
        selection.removeAllRanges();
        return text;
      });
      expect(selected).toBe(source);
      await code.locator("..").screenshot({
        path: testInfo.outputPath(`${grammar}.png`),
        animations: "disabled",
      });
    }
  });

  test(`media Markdown fences show syntax colors: ${theme}`, async ({
    page,
  }, testInfo) => {
    await seed(page, { theme });
    await page.goto("./#/media");
    const examples = [
      [
        "RS filename=main.rs",
        "rust",
        'pub fn echo() { println!("Hello"); }',
        "keyword",
      ],
      [
        "TypeScript",
        "typescript",
        'export const message: string = "Hello";',
        "keyword",
      ],
      ["json", "json", '{ "safe": true }', "property"],
    ] as const;
    await page
      .locator("#markdown-source")
      .fill(
        examples
          .map(([info, , source]) => "```" + info + "\n" + source + "\n```")
          .join("\n\n"),
      );
    const preview = page
      .locator("section")
      .filter({ has: page.locator('code[data-language="rust"]') });
    for (const [, grammar, source, token] of examples) {
      const code = preview.locator(`code[data-language="${grammar}"]`);
      await expect(code).toHaveText(source);
      await expect(
        code.locator(`[data-token="${token}"]`).first(),
      ).toBeVisible();
      const colors = await code.evaluate(
        (element, kind) => [
          getComputedStyle(element).color,
          getComputedStyle(element.querySelector(`[data-token="${kind}"]`)!)
            .color,
        ],
        token,
      );
      expect(colors[0]).not.toBe(colors[1]);
    }
    await expect(preview.locator("pre pre")).toHaveCount(0);
    await preview.screenshot({
      path: testInfo.outputPath("markdown.png"),
      animations: "disabled",
    });
  });
}

test("native scrolling stays responsive without scripted edge motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1120, height: 640 });
  await seed(page, { motion: "full" });
  await page.goto("./#/settings");
  await expect(page.locator("main h2")).toBeVisible();
  const chrome = await page.locator(".app-chrome").boundingBox();
  const background = await page
    .locator("[data-window-background]")
    .boundingBox();
  for (const selector of ["main", ".app-sidebar-navigation"]) {
    const viewport = page.locator(selector);
    await expect(viewport).toHaveCSS("overscroll-behavior-y", "contain");
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.mouse.wheel(0, 120);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    for (const direction of [-1, 1]) {
      await viewport.evaluate((element, sign) => {
        element.scrollTop = sign < 0 ? 0 : element.scrollHeight;
      }, direction);
      const range = await viewport.evaluate((element) => element.scrollHeight);
      // A flick and its decreasing tail must never replay application animations.
      for (const delta of [120, 100, 80, 50, 30, 20, 12, 6, 3, 1]) {
        await page.mouse.wheel(0, delta * direction);
        await page.waitForTimeout(35);
        const animated = await viewport.evaluate((element) => {
          let node = element.querySelector(".app-page-content, [role='group']");
          while (node && node !== element) {
            if (
              node.getAnimations().length ||
              getComputedStyle(node).translate !== "none"
            )
              return true;
            node = node.parentElement;
          }
          return false;
        });
        expect(animated).toBe(false);
      }
      expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(
        range,
      );
      expect(await page.locator(".app-chrome").boundingBox()).toEqual(chrome);
      expect(
        await page.locator("[data-window-background]").boundingBox(),
      ).toEqual(background);
      expect(
        await page.evaluate(() => document.scrollingElement?.scrollTop),
      ).toBe(0);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const selector of ["main", ".app-sidebar-navigation"]) {
    await expect(page.locator(selector)).toHaveCSS(
      "overscroll-behavior-y",
      "none",
    );
  }
});

for (const theme of ["light", "dark"]) {
  test(
    "surface colors follow the skin and selected accent: " + theme,
    async ({ page }) => {
      await seed(page, { theme, background: "plain", accent: "neutral" });
      await page.goto("./#/settings");
      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-background", "plain");
      const color = (selector = "body") =>
        page.locator(selector).evaluate((element) => {
          const context = document.createElement("canvas").getContext("2d")!;
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
        });
      const neutral = await color();
      expect(Math.max(...neutral) - Math.min(...neutral)).toBeLessThanOrEqual(
        1,
      );
      const skinColors: number[][] = [];
      for (const skin of ["dune", "starlight", "botanical"]) {
        await page
          .locator(`label:has(input[name="background-skin"][value="${skin}"])`)
          .click();
        await expect(html).toHaveAttribute("data-background", skin);
        skinColors.push(await color());
      }
      expect(
        skinColors.every((value) => value.join(",") === neutral.join(",")),
      ).toBe(true);
      await page
        .locator('label:has(input[name="background-skin"][value="plain"])')
        .click();
      await expect.poll(color).toEqual(neutral);
      await page
        .locator("#settings-accent")
        .getByRole("button", { name: "Blue", exact: true })
        .click();
      await expect(html).toHaveAttribute("data-accent", "blue");
      const blue = await color();
      const blueSelection = await color(
        '.app-sidebar-link[aria-current="page"]',
      );
      await page
        .locator("#settings-accent")
        .getByRole("button", { name: "Rose", exact: true })
        .click();
      await expect(html).toHaveAttribute("data-accent", "rose");
      const rose = await color();
      const roseSelection = await color(
        '.app-sidebar-link[aria-current="page"]',
      );
      expect(blue).not.toEqual(neutral);
      expect(rose).not.toEqual(blue);
      expect(blue[2]).toBeGreaterThan(blue[0]!);
      expect(rose[0]).toBeGreaterThan(rose[1]!);
      expect(blueSelection[2]).toBeGreaterThan(blueSelection[0]!);
      expect(roseSelection[0]).toBeGreaterThan(roseSelection[1]!);
    },
  );
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector)!;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const main = document.querySelector("main")!;
    const navigation = document.querySelector(".app-sidebar-navigation")!;
    return {
      content: rect(".app-page-content"),
      background: rect("[data-window-background]"),
      main: rect("main"),
      chrome: rect(".app-chrome"),
      mainScrollTop: main.scrollTop,
      navigationScrollTop: navigation.scrollTop,
      rootScrollTop: document.scrollingElement?.scrollTop,
    };
  });
}

for (const motion of ["full", "reduced"]) {
  test(
    "collapsing the sidebar never reveals stale tooltips: " + motion,
    async ({ page }) => {
      await page.setViewportSize({ width: 1120, height: 740 });
      await seed(page, { motion });
      await page.goto("./#/settings");
      const sidebar = page.locator("#app-sidebar");
      const tips = page.locator('[data-slot="tooltip-content"]');
      const first = sidebar.locator('a[href="#/"]');
      const second = sidebar.locator('a[href="#/catalog"]');
      const firstLabel = await first.innerText();
      const secondLabel = await second.innerText();
      await first.focus();
      await second.focus();
      await expect(tips).toHaveCount(0);
      for (let iteration = 0; iteration < 3; iteration++) {
        await page.mouse.move(900, 200);
        await page.keyboard.press("Control+b");
        await expect(sidebar).toHaveAttribute("data-collapsed", "true");
        await expect(tips).toHaveCount(0);
        await first.focus();
        await expect(tips).toHaveCount(1);
        await expect(page.getByRole("tooltip")).toContainText(firstLabel);
        await second.focus();
        await expect(tips).toHaveCount(1);
        await expect(page.getByRole("tooltip")).toContainText(secondLabel);
        await second.click();
        await expect(page).toHaveURL(/#\/catalog$/);
        await expect(tips).toHaveCount(0);
        await sidebar
          .getByRole("button", { name: "Expand sidebar", exact: true })
          .click();
        await expect(tips).toHaveCount(0);
        await page.mouse.move(900, 200);
      }
    },
  );
}

test("menus and language selection preserve content geometry and scroll position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await seed(page, { background: "aurora" });
  await page.goto("./#/settings");
  await expect(page.locator("main h2")).toBeVisible();
  const presetColumns = () =>
    page
      .locator("#settings-window [data-window-preset]")
      .evaluateAll((buttons) => {
        const first = buttons[0]!.getBoundingClientRect();
        return buttons.filter(
          (button) =>
            Math.abs(button.getBoundingClientRect().y - first.y) < 0.5,
        ).length;
      });
  // 原生截图采集会缩窄后恢复窗口；按实际卡片行数确认响应式布局。
  for (const [width, columns] of [
    [1120, 2],
    [1280, 4],
  ] as const) {
    await page.setViewportSize({ width, height: 820 });
    await expect.poll(presetColumns).toBe(columns);
  }
  // 窗口宽度不变时，拉宽侧栏同样应减少列数，避免预设被挤压。
  const separator = page.locator(
    '[role="separator"][aria-controls="app-sidebar"]',
  );
  await separator.press("End");
  await expect.poll(presetColumns).toBe(2);
  await separator.press("Enter");
  await expect.poll(presetColumns).toBe(4);
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 180;
  });
  const initial = await layout(page);
  for (const name of ["File", "Edit", "View", "Help"]) {
    await page
      .locator(".app-title-bar")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await layout(page)).toEqual(initial);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    expect(await layout(page)).toEqual(initial);
  }
  await page.locator(".app-title-language").click();
  await expect(page.getByRole("listbox")).toBeVisible();
  expect(await layout(page)).toEqual(initial);
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  const translated = await layout(page);
  expect(translated.main).toEqual(initial.main);
  expect(translated.content.x).toBe(initial.content.x);
  expect(translated.content.width).toBe(initial.content.width);
  expect(translated.background).toEqual(initial.background);
  await expect(page.getByText("设置已保存", { exact: true })).toHaveCount(0);
});

test("the main scrollbar stays below chrome and route navigation leaves sidebar and artwork in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1120, height: 740 });
  await seed(page, { background: "dune" });
  await page.goto("./#/settings");
  await expect(page.locator("main h2")).toBeVisible();
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 800;
  });
  await page.locator(".app-sidebar-navigation").evaluate((element) => {
    element.scrollTop = 70;
  });
  const before = await layout(page);
  expect(before.main.y).toBe(before.chrome.height);
  expect(before.rootScrollTop).toBe(0);
  await page.locator('#app-sidebar a[href="#/network"]').click();
  await expect(page).toHaveURL(/#\/network$/);
  await expect(page.locator("main h2")).toBeVisible();
  const after = await layout(page);
  expect(after.mainScrollTop).toBe(0);
  expect(after.navigationScrollTop).toBe(before.navigationScrollTop);
  expect(after.background).toEqual(before.background);
  expect(after.main).toEqual(before.main);
});

test("both scrollbars use thin arrowless tracks and fade after the pointer leaves", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seed(page, { motion: "full" });
  await page.goto("./#/settings");
  const navigation = page.locator(".app-sidebar-navigation");
  const main = page.locator("main");
  await expect(page.locator("main h2")).toBeVisible();
  for (const region of [navigation, main]) {
    const style = await region.evaluate((element) => ({
      width: getComputedStyle(element, "::-webkit-scrollbar").width,
      arrows: getComputedStyle(element, "::-webkit-scrollbar-button").display,
    }));
    expect(style).toEqual({ width: "8px", arrows: "none" });
  }
  await navigation.hover();
  await expect
    .poll(() =>
      navigation.evaluate((element) =>
        Number(
          getComputedStyle(element).getPropertyValue("--app-scrollbar-opacity"),
        ),
      ),
    )
    .toBe(0.2);
  await page.mouse.move(10, 10);
  await expect
    .poll(() =>
      navigation.evaluate((element) =>
        Number(
          getComputedStyle(element).getPropertyValue("--app-scrollbar-opacity"),
        ),
      ),
    )
    .toBe(0);
});

async function wallpaperFile(page: Page, name: string, color: string) {
  const source = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = fill;
    context.fillRect(0, 0, 320, 200);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(80, 65, 30, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, color);
  return { name, mimeType: "image/png", buffer: Buffer.from(source, "base64") };
}

test("wallpaper library supports multi-import, rename, deletion and shared browser storage", async ({
  page,
  context,
}, testInfo) => {
  await seed(page, { theme: "dark" });
  await page.goto("./#/settings");
  await expect(
    page.getByRole("button", { name: "Add wallpapers", exact: true }),
  ).toBeEnabled();
  const first = await wallpaperFile(page, "sky.png", "#94bddc");
  const second = await wallpaperFile(page, "rose.png", "#d8a4b2");
  await page.locator('input[type="file"]').setInputFiles([
    first,
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("broken"),
    },
    second,
  ]);
  await expect(page.locator(".wallpaper-card")).toHaveCount(2);
  await page
    .locator('[data-sonner-toast][data-type="error"]')
    .getByRole("button", { name: "View details" })
    .click();
  const importDetails = page.getByRole("dialog", {
    name: "Images not imported",
  });
  await expect(importDetails).toContainText("broken.png");
  await importDetails
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Use wallpaper: rose.png", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("radio", { name: "Use wallpaper: sky.png", exact: true })
    .locator("..")
    .click();
  await expect(page.locator("[data-custom-background]")).toHaveAttribute(
    "src",
    (await page
      .locator(".wallpaper-card")
      .first()
      .locator("img")
      .getAttribute("src")) as string,
  );
  await page.locator('input[type="file"]').setInputFiles(first);
  await expect(
    page.getByRole("button", { name: "Add wallpapers", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".wallpaper-card")).toHaveCount(2);
  const other = await context.newPage();
  await other.goto("./#/settings");
  await expect(other.locator(".wallpaper-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Rename wallpaper: sky.png", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Wallpaper name", exact: true })
    .fill("Morning sky");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    other.getByRole("radio", {
      name: "Use wallpaper: Morning sky",
      exact: true,
    }),
  ).toBeVisible();
  await other
    .getByRole("button", { name: "Delete wallpaper: rose.png", exact: true })
    .click();
  await other
    .getByRole("dialog", { name: "Remove wallpaper from library?" })
    .getByRole("button", { name: "Remove wallpaper", exact: true })
    .click();
  await expect(page.locator(".wallpaper-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".wallpaper-card")).toHaveCount(1);
  await expect(
    page.getByRole("radio", {
      name: "Use wallpaper: Morning sky",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .locator(".wallpaper-library")
    .screenshot({ path: testInfo.outputPath("wallpaper-library.png") });
  await page
    .getByRole("button", { name: "Clear image background", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-background",
    "plain",
  );
  await expect(page.locator(".wallpaper-card")).toHaveCount(1);
  await page
    .getByRole("radio", { name: "Use wallpaper: Morning sky", exact: true })
    .locator("..")
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-background",
    "custom",
  );
  await other.close();
});

test("full screen menu and F11 share real fullscreen state and restore the sidebar", async ({
  page,
}) => {
  await seed(page, { sidebarCollapsed: true, sidebarWidth: 280 });
  await page.goto("./#/settings");
  await page.getByRole("button", { name: "View", exact: true }).click();
  const fullscreen = page.getByRole("menuitem", {
    name: /Immersive fullscreen/,
  });
  await expect(fullscreen).toContainText("F11");
  await fullscreen.click();
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell-immersive/);
  expect(
    await page.evaluate(
      () => document.fullscreenElement === document.documentElement,
    ),
  ).toBe(true);
  await expect(page.locator(".app-chrome")).toBeHidden();
  await expect(page.locator("#app-sidebar")).toBeHidden();
  const full = await page.locator("main").boundingBox();
  expect(full?.x).toBe(0);
  expect(full?.y).toBe(0);
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await expect(page.locator(".app-shell")).not.toHaveClass(
    /app-shell-immersive/,
  );
  await expect(page.locator("#app-sidebar")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await page.keyboard.press("F11");
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell-immersive/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell")).not.toHaveClass(
    /app-shell-immersive/,
  );
  const settings = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(settings.sidebarCollapsed).toBe(true);
  expect(settings.sidebarWidth).toBe(280);
  await expect(page.locator(".app-chrome")).toBeVisible();
});

test("a local background imports, survives reload, keeps the last good image on failure and can be removed", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).hostname !== "127.0.0.1"
    )
      external.push(request.url());
  });
  await seed(page);
  await page.goto("./#/settings");
  const source = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1900;
    canvas.height = 1100;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 1900, 1100);
    gradient.addColorStop(0, "#5b719c");
    gradient.addColorStop(1, "#b8d3bf");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1900, 1100);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const input = page.locator('input[type="file"]');
  await expect(
    page.getByRole("button", { name: "Add wallpapers", exact: true }),
  ).toBeEnabled();
  await input.setInputFiles({
    name: "landscape.png",
    mimeType: "image/png",
    buffer: Buffer.from(source, "base64"),
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-background",
    "custom",
  );
  await expect
    .poll(() =>
      page
        .locator("[data-custom-background]")
        .evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth <= 1600 &&
            image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  const saved = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!) as {
        customBackground: { dataUrl: string; name: string; fit: string };
      },
    KEY,
  );
  expect(saved.customBackground.name).toBe("landscape.png");
  expect(saved.customBackground.dataUrl).toMatch(
    /^data:image\/(webp|jpeg);base64,/,
  );
  expect(saved.customBackground.dataUrl.length).toBeLessThanOrEqual(96 * 1024);
  await page.getByRole("combobox", { name: "Image fit", exact: true }).click();
  await page
    .getByRole("option", { name: "Show full image", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("[data-custom-background]")).toHaveCSS(
    "object-fit",
    "contain",
  );
  await expect(page.getByText("landscape.png", { exact: true })).toBeVisible();
  await input.setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("broken image"),
  });
  await page
    .locator('[data-sonner-toast][data-type="error"]')
    .getByRole("button", { name: "View details" })
    .click();
  const importDetails = page.getByRole("dialog", {
    name: "Images not imported",
  });
  await expect(importDetails).toContainText("could not be read");
  await importDetails
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator("[data-custom-background]")).toHaveAttribute(
    "src",
    saved.customBackground.dataUrl,
  );
  await page
    .getByRole("button", {
      name: "Delete wallpaper: landscape.png",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Remove wallpaper from library?" })
    .getByRole("button", { name: "Remove wallpaper", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-background",
    "plain",
  );
  await expect(page.locator("[data-custom-background]")).toHaveCount(0);
  const removed = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!) as { customBackground: unknown },
    KEY,
  );
  expect(removed.customBackground).toBeNull();
  expect(external).toEqual([]);
});

for (const theme of ["light", "dark"]) {
  test(
    "eight linework skins share their previews and follow the theme: " + theme,
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "light" : "dark",
      });
      await seed(page, { theme, backgroundIntensity: "strong" });
      await page.goto("./#/settings");
      const sources: string[] = [];
      for (const kind of [
        "aurora",
        "dune",
        "inkwash",
        "starlight",
        "sakura",
        "moonlit",
        "botanical",
        "cloudscape",
      ]) {
        await page
          .locator(
            'label:has(input[name="background-skin"][value="' + kind + '"])',
          )
          .click();
        const actual = page.locator("[data-window-background] .skin-scene");
        const preview = page.locator(
          '.skin-gallery [data-pattern="' + kind + '"] .skin-scene',
        );
        const source = await preview.evaluate(
          (element) => getComputedStyle(element).maskImage,
        );
        sources.push(source);
        await expect(actual).toHaveCSS("mask-image", source);
        await expect(actual).toHaveCSS("filter", "none");
        const contrast = await actual.evaluate(async (element) => {
          const style = getComputedStyle(element);
          const image = new Image();
          image.src = style.maskImage.slice(5, -2);
          await image.decode();
          const mask = document.createElement("canvas");
          mask.width = 160;
          mask.height = 100;
          const inkContext = mask.getContext("2d")!;
          inkContext.drawImage(image, 0, 0, 160, 100);
          inkContext.globalCompositeOperation = "source-in";
          inkContext.fillStyle = style.backgroundColor;
          inkContext.fillRect(0, 0, 160, 100);
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 100;
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(
            element.parentElement!,
          ).backgroundColor;
          context.fillRect(0, 0, 160, 100);
          context.globalAlpha = Number(style.opacity);
          context.drawImage(mask, 0, 0);
          const backdrop = context.getImageData(0, 0, 160, 100).data;
          context.globalAlpha = 1;
          context.fillStyle = getComputedStyle(
            document.documentElement,
          ).getPropertyValue("--muted-foreground");
          context.fillRect(0, 0, 1, 1);
          const foreground = context.getImageData(0, 0, 1, 1).data;
          const luminance = (r: number, g: number, b: number) =>
            [r, g, b].reduce((sum, value, i) => {
              const c = value / 255;
              return (
                sum +
                (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
                  [0.2126, 0.7152, 0.0722][i]!
              );
            }, 0);
          const text = luminance(
            foreground[0]!,
            foreground[1]!,
            foreground[2]!,
          );
          let minimum = Infinity;
          for (let i = 0; i < backdrop.length; i += 4) {
            const background = luminance(
              backdrop[i]!,
              backdrop[i + 1]!,
              backdrop[i + 2]!,
            );
            minimum = Math.min(
              minimum,
              (Math.max(text, background) + 0.05) /
                (Math.min(text, background) + 0.05),
            );
          }
          return minimum;
        });
        expect(
          contrast,
          kind + " keeps secondary text readable",
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(new Set(sources).size).toBe(8);
      const ink = page.locator("[data-window-background] .skin-scene");
      const original = await ink.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await page
        .locator("#settings-accent")
        .getByRole("button", { name: "Blue", exact: true })
        .click();
      await expect(ink).not.toHaveCSS("background-color", original);
      const blue = await ink.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await page
        .locator("#settings-accent")
        .getByRole("button", { name: "Rose", exact: true })
        .click();
      await expect(ink).not.toHaveCSS("background-color", blue);
      await expect(page.locator(".app-title-bar")).toHaveCSS(
        "backdrop-filter",
        "none",
      );
      const transparency = await page.locator("html").evaluate((element) => {
        const style = getComputedStyle(element);
        return [
          style.getPropertyValue("--skin-chrome-opacity"),
          style.getPropertyValue("--skin-sidebar-opacity"),
        ].map(parseFloat);
      });
      expect(transparency.every((opacity) => opacity <= 30)).toBe(true);
      await page
        .locator(".skin-gallery")
        .screenshot({ path: testInfo.outputPath("skins-" + theme + ".png") });
      await page.screenshot({
        path: testInfo.outputPath("window-" + theme + ".png"),
      });
      await page.locator('#app-sidebar a[href="#/"]').click();
      if (theme === "dark")
        await expect(page.locator(".showroom-scene-aura")).toBeHidden();
    },
  );

  test(
    "secondary copy stays readable over an extreme custom background: " + theme,
    async ({ page }) => {
      await seed(page, { theme, backgroundIntensity: "strong" });
      await page.goto("./#/settings");
      const source = await page.evaluate((value) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 16;
        const context = canvas.getContext("2d")!;
        context.fillStyle = value === "light" ? "#000" : "#fff";
        context.fillRect(0, 0, 16, 16);
        return canvas.toDataURL("image/png").split(",")[1]!;
      }, theme);
      await expect(
        page.getByRole("button", { name: "Add wallpapers", exact: true }),
      ).toBeEnabled();
      await page.locator('input[type="file"]').setInputFiles({
        name: "contrast.png",
        mimeType: "image/png",
        buffer: Buffer.from(source, "base64"),
      });
      await expect(page.locator("html")).toHaveAttribute(
        "data-background",
        "custom",
      );
      await page.locator('#app-sidebar a[href="#/"]').click();
      await expect(page.locator(".showroom-lede")).toBeVisible();
      const contrast = await page.evaluate(async () => {
        const image = document.querySelector<HTMLImageElement>(
          "[data-custom-background]",
        )!;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 1, 1);
        const pixel = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        const rgb = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const surface = rgb(
          getComputedStyle(image.parentElement!).backgroundColor,
        );
        // 主体与导航各自保留阅读表面，计算实际叠加后的图片强度。
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(
          document.querySelector("main")!,
        ).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const surfaceAlpha = context.getImageData(0, 0, 1, 1).data[3]! / 255;
        const alpha =
          Number(getComputedStyle(image).opacity) * (1 - surfaceAlpha);
        const background = surface.map(
          (value, index) => value * (1 - alpha) + pixel[index]! * alpha,
        );
        const foreground = rgb(
          getComputedStyle(document.querySelector(".showroom-lede")!).color,
        );
        const luminance = (color: number[]) =>
          color.reduce((total, value, index) => {
            const channel = value / 255;
            const linear =
              channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            return total + linear * [0.2126, 0.7152, 0.0722][index]!;
          }, 0);
        const values = [luminance(background), luminance(foreground)];
        return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );
}

test("the settings gallery and background controls have no detected WCAG A/AA violations", async ({
  page,
}) => {
  await seed(page, { background: "aurora" });
  await page.goto("./#/settings");
  await expect(page.locator("main h2")).toBeVisible();
  const scan = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator("[data-window-background]")).toBeHidden();
});

for (const profile of [
  {
    name: "zh-light",
    language: "zh",
    theme: "light",
    width: 1280,
    height: 820,
    sidebarWidth: 224,
    fontSize: "md",
  },
  {
    name: "en-dark",
    language: "en",
    theme: "dark",
    width: 1280,
    height: 820,
    sidebarWidth: 224,
    fontSize: "md",
  },
  {
    name: "zh-compact-wide-sidebar",
    language: "zh",
    theme: "light",
    width: 880,
    height: 600,
    sidebarWidth: 360,
    fontSize: "lg",
  },
  {
    name: "en-mobile-large-font",
    language: "en",
    theme: "dark",
    width: 390,
    height: 844,
    sidebarWidth: 224,
    fontSize: "lg",
  },
]) {
  test(
    "all routes remain readable without horizontal overflow: " + profile.name,
    async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({
        width: profile.width,
        height: profile.height,
      });
      await seed(page, { ...profile, background: "aurora" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const route of routes) {
        await page.goto("./#" + route);
        await expect(page.locator("main h2").first()).toBeVisible();
        const dimensions = await page.locator("main").evaluate((element) => ({
          viewport: element.clientWidth,
          content: element.scrollWidth,
          height: element.clientHeight,
          documentScroll: document.scrollingElement?.scrollTop,
        }));
        expect(
          dimensions.content,
          profile.name + " " + route,
        ).toBeLessThanOrEqual(dimensions.viewport + 1);
        expect(dimensions.height).toBeGreaterThan(250);
        expect(dimensions.documentScroll).toBe(0);
        if (
          [
            "/",
            "/settings",
            "/components",
            "/data-studio",
            "/media",
            "/motion",
          ].includes(route)
        ) {
          await page.screenshot({
            path: testInfo.outputPath(
              (route === "/" ? "showroom" : route.slice(1)) + ".png",
            ),
          });
        }
      }
      expect(errors).toEqual([]);
    },
  );
}

/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

async function renderedControlPixel(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const bounds = (await locator.boundingBox())!;
  const rendered = await page.screenshot({ animations: "disabled" });
  return page.evaluate(
    async ({ encoded, x, y }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    },
    {
      encoded: rendered.toString("base64"),
      x: bounds.x + bounds.width - 24,
      y: bounds.y + bounds.height / 2,
    },
  );
}

async function measureFrostedText(locator: Locator, placeholder = false) {
  return locator.evaluate(async (node, usePlaceholder) => {
    const image = document.querySelector<HTMLImageElement>(
      "[data-custom-background]",
    )!;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const probeContext = probe.getContext("2d")!;
    const alpha = (color: string) => {
      probeContext.clearRect(0, 0, 1, 1);
      probeContext.fillStyle = color;
      probeContext.fillRect(0, 0, 1, 1);
      return probeContext.getImageData(0, 0, 1, 1).data[3]! / 255;
    };
    const ancestors = (element: Element, stop: Element) => {
      const layers: Element[] = [];
      for (
        let layer: Element | null = element;
        layer;
        layer = layer.parentElement
      ) {
        layers.unshift(layer);
        if (layer === stop) return layers;
      }
      throw new Error("The measured text has no expected reading surface");
    };
    // 纯黑 / 白图片使背景模糊不依赖取样位置。
    // 将实际图片、阅读表面和控件背景合成为像素，再计算文字对比度。
    context.fillStyle = getComputedStyle(image.parentElement!).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    context.globalAlpha = Number(getComputedStyle(image).opacity);
    context.drawImage(image, 0, 0, 1, 1);
    let wallpaperExposure = context.globalAlpha;
    context.globalAlpha = 1;
    const popup = node.closest(
      '[data-slot="select-content"], [data-slot="popover-content"]',
    );
    let layers: Element[];
    if (popup) {
      const bounds = node.getBoundingClientRect();
      const bodyPointerEvents =
        document.body.style.getPropertyValue("pointer-events");
      const bodyPriority =
        document.body.style.getPropertyPriority("pointer-events");
      const popupPointerEvents = (popup as HTMLElement).style.getPropertyValue(
        "pointer-events",
      );
      const popupPriority = (popup as HTMLElement).style.getPropertyPriority(
        "pointer-events",
      );
      let underneath: Element | undefined;
      try {
        // Radix 模态选择器会锁定页面命中；只在同步取样期间恢复命中，不改变绘制。
        document.body.style.setProperty("pointer-events", "auto");
        (popup as HTMLElement).style.setProperty("pointer-events", "none");
        underneath = document
          .elementsFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          )
          .find(
            (element) => !popup.contains(element) && element.closest("main"),
          );
      } finally {
        if (bodyPointerEvents)
          document.body.style.setProperty(
            "pointer-events",
            bodyPointerEvents,
            bodyPriority,
          );
        else document.body.style.removeProperty("pointer-events");
        if (popupPointerEvents)
          (popup as HTMLElement).style.setProperty(
            "pointer-events",
            popupPointerEvents,
            popupPriority,
          );
        else (popup as HTMLElement).style.removeProperty("pointer-events");
      }
      if (!underneath) throw new Error("No page surface behind the popup");
      layers = [
        ...ancestors(underneath, underneath.closest("main")!),
        ...ancestors(node, popup),
      ];
    } else {
      layers = ancestors(node, node.closest("main")!);
    }
    const readingSurfaceColor = getComputedStyle(
      document.querySelector("[data-window-reading-surface]")!,
    ).backgroundColor;
    for (const layer of layers) {
      const color = layer.matches("main")
        ? readingSurfaceColor
        : getComputedStyle(layer).backgroundColor;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      wallpaperExposure *= 1 - alpha(color);
    }
    const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const text = getComputedStyle(
      node,
      usePlaceholder ? "::placeholder" : null,
    );
    context.globalAlpha = Number(text.opacity);
    context.fillStyle = text.color;
    context.fillRect(0, 0, 1, 1);
    const foreground = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
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
    return {
      contrast: (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05),
      wallpaperExposure,
      background,
      foreground,
    };
  }, placeholder);
}

for (const theme of ["light", "dark"]) {
  test(`page panels and fields share their skin transparency on every route: ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await seed(page, { theme, background: "aurora" });
    for (const route of routes) {
      await page.goto("./#" + route);
      await expect(page.locator("main h2").first()).toBeVisible();
      for (const exposure of [0, 0.5, 1]) {
        const failures = () =>
          page.evaluate((value) => {
            document.documentElement.style.setProperty(
              "--skin-exposure",
              String(value),
            );
            document.documentElement.dataset.backgroundIntensity = String(
              value * 100,
            );
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            const alpha = (node: Element) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = getComputedStyle(node).backgroundColor;
              context.fillRect(0, 0, 1, 1);
              return context.getImageData(0, 0, 1, 1).data[3]!;
            };
            const panels = document.querySelectorAll(
              'main :is([data-slot="card"], [data-slot="card-footer"], .app-surface, .studio-panel, .experience-route, .journey-guide, .native-flow li, .workspace-demo, .workspace-tree-panel, .lab-console, .lab-control-panel, .playground-surface, .resource-card, .wallpaper-library, .wallpaper-card)',
            );
            const failures: string[] = [];
            for (const panel of panels) {
              // About has one outer surface; its nested cards deliberately share it.
              const expected = panel.closest(".settings-about-content")
                ? 0
                : Math.round(
                    255 * Math.max(1 - 1.4 * value, 0.6 - 0.6 * value),
                  );
              if (Math.abs(alpha(panel) - expected) > 1)
                failures.push(
                  `${panel.tagName}.${panel.className}: ${alpha(panel)} != ${expected}`,
                );
            }
            for (const field of document.querySelectorAll(
              'main :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]):not(:disabled)',
            )) {
              const expected = Math.round(
                255 *
                  (value === 0
                    ? 1
                    : Math.max(
                        1 - 1.4 * value,
                        1 - 0.35 / Math.max(value, 0.35),
                      )),
              );
              if (Math.abs(alpha(field) - expected) > 1)
                failures.push(`field ${field.id}: ${alpha(field)}`);
            }
            return failures;
          }, exposure);
        await expect
          .poll(failures, { message: `${theme} ${route} exposure=${exposure}` })
          .toEqual([]);
      }
    }
  });

  test(`fields and popups use readable frost and restore solid fallback: ${theme}`, async ({
    page,
  }, testInfo) => {
    await seed(page, { theme, background: "aurora" });
    await page.goto("./#/settings");
    const search = page.getByRole("searchbox", {
      name: "Search settings",
      exact: true,
    });
    const slider = page.getByRole("slider", {
      name: "Background transparency",
      exact: true,
    });
    const font = page.getByRole("combobox", { name: "Font", exact: true });
    const measure = async (selector: string) =>
      page.locator(selector).evaluate((node) => {
        const style = getComputedStyle(node);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return {
          alpha: context.getImageData(0, 0, 1, 1).data[3]! / 255,
          blur: Number(style.backdropFilter.match(/[\d.]+/)?.[0] ?? 0),
        };
      });
    for (const value of [0, 10, 30, 50, 70, 100]) {
      await slider.press("Home");
      for (let step = 0; step < value / 10; step++)
        await slider.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuenow", String(value));
      await expect
        .poll(async () => (await measure('input[type="search"]')).blur)
        .toBeCloseTo(value * 0.18, 4);
      const field = await measure('input[type="search"]');
      const intensity = value / 100;
      const expectedAlpha = Math.max(
        1 - 1.4 * intensity,
        1 - 0.35 / Math.max(intensity, 0.35),
      );
      expect(field.alpha).toBeCloseTo(expectedAlpha, 2);
      // 图片与主体阅读底色位于控件下方，中间档仍应明显透出壁纸。
      const exposure = await search.evaluate((node) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        let transmission = Number(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--skin-exposure",
          ),
        );
        const readingSurfaceColor = getComputedStyle(
          document.querySelector("[data-window-reading-surface]")!,
        ).backgroundColor;
        for (
          let layer: Element | null = node;
          layer;
          layer = layer.parentElement
        ) {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = layer.matches("main")
            ? readingSurfaceColor
            : getComputedStyle(layer).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          transmission *= 1 - context.getImageData(0, 0, 1, 1).data[3]! / 255;
          if (layer.matches("main")) break;
        }
        return transmission;
      });
      expect(exposure).toBeCloseTo(intensity ** 2 * (1 - expectedAlpha), 2);
      await font.click();
      const menu = page.locator('[data-slot="select-content"]');
      await expect(menu).toHaveCSS("opacity", "1");
      await menu.evaluate(async (node) => {
        await Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const popup = await measure('[data-slot="select-content"]');
      expect(popup.alpha).toBeCloseTo(expectedAlpha, 2);
      expect(popup.blur).toBeCloseTo(value * 0.28, 4);
      if (value === 50)
        await page.screenshot({
          path: testInfo.outputPath(`frost-50-${theme}.png`),
        });
      await page.keyboard.press("Escape");
    }
    await search.fill("font");
    await expect(
      page.getByRole("dialog", { name: "Search settings", exact: true }),
    ).toBeVisible();
    expect((await measure('[data-slot="popover-content"]')).alpha).toBeLessThan(
      1,
    );
    await search.press("Escape");
    await page
      .locator('label:has(input[name="background-skin"][value="plain"])')
      .click();
    await expect
      .poll(() => measure('input[type="search"]'))
      .toEqual({ alpha: 1, blur: 0 });
    await page
      .locator('label:has(input[name="background-skin"][value="aurora"])')
      .click();
    await page.emulateMedia({ forcedColors: "active" });
    await expect
      .poll(() => measure('input[type="search"]'))
      .toEqual({ alpha: 1, blur: 0 });
  });

  test(`50% frost exposes wallpaper and keeps placeholder and popup text readable: ${theme}`, async ({
    page,
  }, testInfo) => {
    await seed(page, { theme, backgroundIntensity: 50 });
    await page.goto("./#/settings");
    const search = page.getByRole("searchbox", {
      name: "Search settings",
      exact: true,
    });
    const renderedInputs: number[][] = [];
    const renderedSelects: number[][] = [];
    for (const background of ["black", "white"]) {
      const source = await page.evaluate((color) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 16;
        const context = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 16, 16);
        return canvas.toDataURL("image/png").split(",")[1]!;
      }, background);
      await page.locator('input[type="file"]').setInputFiles({
        name: `frost-${background}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(source, "base64"),
      });
      await expect(page.locator("html")).toHaveAttribute(
        "data-background",
        "custom",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-background-intensity",
        "50",
      );
      await expect
        .poll(() =>
          page.locator("[data-custom-background]").evaluate(async (element) => {
            const image = element as HTMLImageElement;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0, 1, 1);
            return context.getImageData(0, 0, 1, 1).data[0]!;
          }),
        )
        .toBe(background === "black" ? 0 : 255);
      const placeholder = await measureFrostedText(search, true);
      expect(
        placeholder.contrast,
        `${background} input placeholder`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(placeholder.wallpaperExposure).toBeGreaterThan(0.15);
      // 对照最终渲染像素，防止原生表单或合成层额外绘制不透明底色。
      renderedInputs.push(await renderedControlPixel(page, search));
      renderedSelects.push(
        await renderedControlPixel(
          page,
          page.getByRole("combobox", { name: "Font", exact: true }),
        ),
      );

      await page.getByRole("combobox", { name: "Font", exact: true }).click();
      const select = page.locator('[data-slot="select-content"]');
      await expect(select).toHaveCSS("opacity", "1");
      await select.evaluate(async (node) => {
        await Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const option = await measureFrostedText(
        select
          .locator('[data-slot="select-item"]:not([data-highlighted])')
          .first(),
      );
      expect(
        option.contrast,
        `${background} select option`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(option.wallpaperExposure).toBeGreaterThan(0.05);
      await page.screenshot({
        path: testInfo.outputPath(`frost-50-${theme}-${background}.png`),
      });
      await page.keyboard.press("Escape");

      await search.fill("language");
      await page.mouse.move(0, 0);
      const popup = page.getByRole("dialog", {
        name: "Search settings",
        exact: true,
      });
      await expect(popup).toHaveCSS("opacity", "1");
      await popup.evaluate(async (node) => {
        await Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      for (const [label, locator] of [
        ["search result", popup.locator("li button span.truncate").first()],
        ["search status", popup.getByRole("status")],
        [
          "search description",
          popup.locator("li .text-muted-foreground").first(),
        ],
      ] as const) {
        const result = await measureFrostedText(locator);
        expect(
          result.contrast,
          `${background} ${label}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          result.wallpaperExposure,
          `${background} ${label}`,
        ).toBeGreaterThan(0.05);
      }
      await search.press("Escape");
    }

    await testInfo.attach("rendered-input-pixels", {
      body: JSON.stringify(renderedInputs),
      contentType: "application/json",
    });
    for (let channel = 0; channel < 3; channel++)
      expect(
        (renderedInputs[1]![channel]! - renderedInputs[0]![channel]!) / 255,
      ).toBeGreaterThan(0.15);

    for (let channel = 0; channel < 3; channel++)
      expect(
        (renderedSelects[1]![channel]! - renderedSelects[0]![channel]!) / 255,
      ).toBeGreaterThan(0.06);

    const colorfulSource = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, 640, 360);
      gradient.addColorStop(0, "#d89843");
      gradient.addColorStop(0.45, "#318f91");
      gradient.addColorStop(1, "#355f9c");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 640, 360);
      context.fillStyle = "#ffffff24";
      for (let x = 24; x < 640; x += 80) context.fillRect(x, 0, 16, 360);
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "frost-colors.png",
      mimeType: "image/png",
      buffer: Buffer.from(colorfulSource, "base64"),
    });
    await expect(
      page.getByRole("radio", {
        name: "Use wallpaper: frost-colors.png",
        exact: true,
      }),
    ).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute(
      "data-background-intensity",
      "50",
    );
    await page.locator("main").evaluate((node) => node.scrollTo(0, 0));
    await page.getByRole("button", { name: "View", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toHaveCSS("opacity", "1");
    await menu.evaluate(async (node) => {
      await Promise.all(
        node
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await page.screenshot({
      path: testInfo.outputPath(`frost-50-color-${theme}.png`),
    });
    await page.keyboard.press("Escape");
  });

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
  await page.getByRole("option", { name: "Interaction", exact: true }).click();
  await expect(page).toHaveURL(/#\/components$/);
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
          hasText: chinese ? /^文件工作台$/ : /^File workbench$/,
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
      const second = sidebar.locator('a[href="#/data-studio"]');
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
        await expect(page).toHaveURL(/#\/data-studio$/);
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
  const background = page.locator("[data-custom-background]");
  await expect(background).toHaveAttribute("src", /^data:image\/(webp|jpeg);/);
  await expect
    .poll(() =>
      background.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(320);
  const thumbnail = page.locator(".wallpaper-card").first().locator("img");
  await expect(thumbnail).toHaveAttribute("src", /^data:image\/png;/);
  expect(await background.getAttribute("src")).not.toBe(
    await thumbnail.getAttribute("src"),
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
  test(`skin intensity has eleven stops, opaque and transparent endpoints, and persists: ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width: theme === "light" ? 880 : 1280,
      height: 900,
    });
    await seed(page, {
      theme,
      background: "aurora",
      sidebarWidth: theme === "light" ? 360 : 224,
    });
    await page.goto("./#/settings");
    const slider = page.getByRole("slider", {
      name: "Background transparency",
      exact: true,
    });
    await expect(slider).toHaveAttribute("aria-valuenow", "50");
    const source = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 500;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, 800, 500);
      gradient.addColorStop(0, "#205b86");
      gradient.addColorStop(0.5, "#a55476");
      gradient.addColorStop(1, "#ecb65c");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 800, 500);
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "intensity.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-background",
      "custom",
    );
    const layers = () =>
      page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const nodes = [
          document.querySelector(".app-title-bar")!,
          document.querySelector(".app-sidebar")!,
          document.querySelector(".app-main")!,
          document
            .querySelector("#settings-backgroundIntensity")!
            .closest('[data-slot="card"]')!,
        ];
        const readingSurfaceColor = getComputedStyle(
          document.querySelector("[data-window-reading-surface]")!,
        ).backgroundColor;
        const surfaces = nodes.map((node) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = node.matches("main")
            ? readingSurfaceColor
            : getComputedStyle(node).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3]! / 255;
        });
        return {
          image: Number(
            getComputedStyle(
              document.querySelector("[data-custom-background]")!,
            ).opacity,
          ),
          surfaces,
        };
      });
    await slider.press("Home");
    await expect.poll(layers).toEqual({ image: 0, surfaces: [1, 1, 1, 1] });
    let previous = await layers();
    expect(previous).toEqual({ image: 0, surfaces: [1, 1, 1, 1] });
    await page.screenshot({
      path: testInfo.outputPath(`intensity-${theme}-0.png`),
    });
    for (let value = 10; value <= 100; value += 10) {
      await slider.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuenow", String(value));
      await expect(slider).toHaveAttribute(
        "aria-valuetext",
        `${value}% · Stop ${value / 10 + 1} of 11`,
      );
      await expect
        .poll(async () => {
          const sample = await layers();
          return [
            sample.image,
            ...sample.surfaces.map((alpha) => Math.round(alpha * 100)),
          ];
        })
        .toEqual([
          value / 100,
          100 - value,
          100 - value,
          100 - value,
          Math.round(
            100 * Math.max(1 - (1.4 * value) / 100, 0.6 - (0.6 * value) / 100),
          ),
        ]);
      const actual = await layers();
      expect(actual.image).toBeGreaterThan(previous.image);
      actual.surfaces.forEach((alpha, index) =>
        expect(alpha).toBeLessThanOrEqual(previous.surfaces[index]!),
      );
      if (value === 50) {
        expect(actual.surfaces[3]).toBeCloseTo(0.3, 2);
        await page.screenshot({
          path: testInfo.outputPath(`intensity-${theme}-50.png`),
        });
      }
      previous = actual;
    }
    await expect.poll(layers).toEqual({ image: 1, surfaces: [0, 0, 0, 0] });
    await page.screenshot({
      path: testInfo.outputPath(`intensity-${theme}-100.png`),
    });
    const track = await page
      .locator('#settings-backgroundIntensity [data-slot="slider"]')
      .boundingBox();
    expect(track).not.toBeNull();
    await page.mouse.move(
      track!.x + track!.width / 2,
      track!.y + track!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      track!.x + track!.width * 0.8,
      track!.y + track!.height / 2,
    );
    await page.mouse.up();
    await expect(slider).toHaveAttribute("aria-valuenow", "80");
    const dimensions = await page.locator("main").evaluate((node) => ({
      width: node.clientWidth,
      content: node.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).backgroundIntensity,
          KEY,
        ),
      )
      .toBe(80);
    await page.reload();
    await expect(slider).toHaveAttribute("aria-valuenow", "80");
    await page
      .locator('label:has(input[name="background-skin"][value="plain"])')
      .click();
    await expect(slider).toHaveAttribute("data-disabled");
  });

  test(
    "eight linework skins share their previews and follow the theme: " + theme,
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "light" : "dark",
      });
      await seed(page, { theme, backgroundIntensity: 50 });
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
          context.globalAlpha = 1;
          context.fillStyle = getComputedStyle(
            document.querySelector("[data-window-reading-surface]")!,
          ).backgroundColor;
          context.fillRect(0, 0, 160, 100);
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
      const transparency = await page.locator("html").evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        return [".app-title-bar", ".app-sidebar"].map((selector) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = getComputedStyle(
            document.querySelector(selector)!,
          ).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3]! / 255;
        });
      });
      for (const opacity of transparency) expect(opacity).toBeCloseTo(0.5, 2);
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
      await seed(page, { theme, backgroundIntensity: 50 });
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
          document.querySelector("[data-window-reading-surface]")!,
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

/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const KEY = "tauri-starter:settings";
const routes = [
  "/",
  "/catalog",
  "/components",
  "/motion",
  "/workbench",
  "/tasks",
  "/system",
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
  await page.addInitScript((value) => {
    if (!localStorage.getItem("tauri-starter:settings"))
      localStorage.setItem(
        "tauri-starter:settings",
        JSON.stringify({
          schemaVersion: 3,
          language: "en",
          theme: "light",
          motion: "reduced",
          ...value,
        }),
      );
  }, settings);
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
        await second.focus();
        await expect(tips).toHaveCount(1);
        await expect(page.getByRole("tooltip")).toContainText("Capabilities");
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
  await expect(page.getByRole("alert")).toContainText("could not be read");
  await expect(page.locator("[data-custom-background]")).toHaveAttribute(
    "src",
    saved.customBackground.dataUrl,
  );
  await page
    .getByRole("button", { name: "Remove background image", exact: true })
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
    "eight distinct skins share their previews and keep the background free of halos: " +
      theme,
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await seed(page, { theme });
      await page.goto("./#/settings");
      const styles: string[] = [];
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
          .locator(`label:has(input[name="background-skin"][value="${kind}"])`)
          .click();
        const actual = page.locator("[data-window-background] svg");
        const preview = page.locator(
          `.skin-gallery svg[data-pattern="${kind}"]`,
        );
        await expect(actual).toHaveAttribute("data-pattern", kind);
        const style = await preview.getAttribute("data-art-style");
        expect(style).toBeTruthy();
        styles.push(style!);
        await expect(actual).toHaveAttribute("data-art-style", style!);
        expect(
          await actual
            .locator("path")
            .evaluateAll((paths) =>
              paths.map((path) => path.getAttribute("d")),
            ),
        ).toEqual(
          await preview
            .locator("path")
            .evaluateAll((paths) =>
              paths.map((path) => path.getAttribute("d")),
            ),
        );
        await expect(
          actual.locator("radialGradient, filter, image, foreignObject"),
        ).toHaveCount(0);
      }
      expect(new Set(styles).size).toBe(8);
      expect(styles.filter((style) => style === "anime")).toHaveLength(1);
      await page.locator(".skin-gallery").screenshot({
        path: testInfo.outputPath("skins-" + theme + ".png"),
      });
      await page.locator('#app-sidebar a[href="#/"]').click();
      await expect(page.locator(".showroom-scene-aura")).toHaveCount(1);
      if (theme === "dark") {
        await expect(page.locator(".showroom-scene-aura")).toBeHidden();
        await expect(
          page.locator(".showroom-hero-actions > :first-child"),
        ).toHaveCSS("box-shadow", "none");
      }
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
        const alpha = Number(getComputedStyle(image).opacity);
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

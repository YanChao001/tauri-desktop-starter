/// <reference lib="dom" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

const wallpaperId = "bundled:001-秋日花饰少女.jpg";
const source = readFileSync(
  new URL("../../resources/wallpapers/001-秋日花饰少女.jpg", import.meta.url),
);
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test.use({ deviceScaleFactor: 2 });

for (const theme of ["dark", "light"] as const) {
  test(`bundled wallpaper keeps the full image and smooths its thumbnail in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 880, height: 600 });
    await page.addInitScript(
      ({ namespace, theme }) => {
        if (!localStorage.getItem(`${namespace}:settings`))
          localStorage.setItem(
            `${namespace}:settings`,
            JSON.stringify({ language: "en", theme, motion: "reduced" }),
          );
      },
      { namespace: appConfig.browserStorageNamespace, theme },
    );
    await page.goto("./#/settings?section=skin");
    const background = page.locator("img[data-bundled-wallpaper]");
    await expect(background).toBeVisible();
    const original = await background.evaluate(
      async (image: HTMLImageElement) => {
        await image.decode();
        return {
          src: image.src,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      },
    );
    expect(original).toMatchObject({ width: 3840, height: 2160 });
    expect(new URL(original.src).pathname).toMatch(/^\/desktop-demo\/assets\//);
    const response = await page.request.get(original.src);
    expect(response.ok()).toBe(true);
    expect(digest(await response.body())).toBe(digest(source));

    const gallery = page.locator(".skin-gallery");
    const card = gallery.locator(
      `[data-bundled-wallpaper-id="${wallpaperId}"]`,
    );
    const choice = card.getByRole("radio");
    await expect(gallery.locator("label").first()).toHaveAttribute(
      "data-bundled-wallpaper-id",
      wallpaperId,
    );
    await expect(choice).toBeChecked();
    const thumbnail = card.locator("img");
    await expect(thumbnail).toHaveAttribute("src", /^data:image\/png;base64,/);
    const preview = await thumbnail.evaluate(
      async (image: HTMLImageElement) => {
        await image.decode();
        return {
          width: image.naturalWidth,
          target: Math.ceil(
            image.getBoundingClientRect().width * devicePixelRatio,
          ),
        };
      },
    );
    expect(preview.width).toBe(preview.target);

    await gallery.locator('label:has(input[value="plain"])').click();
    await expect(background).toHaveCount(0);
    await expect(
      page.getByRole("slider", { name: "Background transparency" }),
    ).toBeDisabled();
    await card.click();
    await expect(choice).toBeChecked();
    await expect(background).toBeVisible();
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      `${appConfig.browserStorageNamespace}:settings`,
    );
    expect(stored).toMatchObject({
      background: wallpaperId,
      customBackground: null,
    });
    expect(JSON.stringify(stored)).not.toContain("/assets/");
    await page.reload();
    await expect(choice).toBeChecked();
    await expect(background).toBeVisible();
    await expect(thumbnail).toHaveAttribute("src", /^data:image\/png;base64,/);
    await page
      .locator("#settings-skin")
      .screenshot({ path: testInfo.outputPath("gallery.png") });
    const scan = await new AxeBuilder({ page })
      .include("#settings-skin")
      .analyze();
    expect(scan.violations).toEqual([]);
  });
}

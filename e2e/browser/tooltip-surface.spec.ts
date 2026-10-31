/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

async function expectContinuousSurface(page: Page, tooltip: Locator) {
  const bounds = (await tooltip.boundingBox())!;
  const side = await tooltip.getAttribute("data-side");
  const screenshot = await page.screenshot({ animations: "disabled" });
  const pixels = await page.evaluate(
    async ({ encoded, bounds, side }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const horizontal = side === "right";
      const edge = Math.round(horizontal ? bounds.x : bounds.y);
      const center = Math.floor(
        horizontal ? bounds.y + bounds.height / 2 : bounds.x + bounds.width / 2,
      );
      const pixel = (offset: number) => {
        const x = horizontal ? edge + offset : center;
        const y = horizontal ? center : edge + offset;
        return [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
      };
      return {
        body: pixel(10),
        junction: [-3, -2, -1, 0, 1, 2, 3, 4, 5].map(pixel),
      };
    },
    { encoded: screenshot.toString("base64"), bounds, side },
  );
  for (const pixel of pixels.junction) {
    expect(
      Math.max(
        ...pixel.map((channel, index) =>
          Math.abs(channel - pixels.body[index]!),
        ),
      ),
      `Arrow/body junction ${JSON.stringify(pixel)} differs from body ${JSON.stringify(pixels.body)}`,
    ).toBeLessThanOrEqual(2);
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`translucent tooltip arrows join the body without a darker overlap: ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, theme }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            schemaVersion: 3,
            language: "en",
            theme,
            motion: "reduced",
            sidebarCollapsed: true,
            background: "aurora",
            backgroundIntensity: 50,
          }),
        ),
      { key: `${appConfig.browserStorageNamespace}:settings`, theme },
    );
    await page.goto("./#/catalog");
    // 统一两侧的背景，像素差只反映箭头与正文的材质合成。
    await page.evaluate(() => {
      const backdrop = document.createElement("div");
      backdrop.style.cssText =
        "position:fixed;inset:0;z-index:49;pointer-events:none;background:rgb(130 160 190)";
      document.body.append(backdrop);
    });
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await page.locator('#app-sidebar a[href="#/"]').focus();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute("data-side", "right");
    const alpha = await tooltip.evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3]! / 255;
    });
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
    await expectContinuousSurface(page, tooltip);

    const quickActions = page.locator(".app-title-bar").getByRole("button", {
      name: "Quick actions",
      exact: true,
    });
    await quickActions.focus();
    await expect(tooltip).toHaveAttribute("data-side", "bottom");
    await expectContinuousSurface(page, tooltip);
  });
}

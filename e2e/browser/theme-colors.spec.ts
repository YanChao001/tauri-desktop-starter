/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };
import { PRESET_ACCENTS } from "../../src/lib/accent-colors";

const SETTINGS_KEY = `${appConfig.browserStorageNamespace}:settings`;

async function seed(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript(
    ({ key, theme }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            schemaVersion: 5,
            language: "en",
            theme,
            motion: "reduced",
            background: "plain",
            accent: "neutral",
          }),
        );
    },
    { key: SETTINGS_KEY, theme },
  );
}

function savedAccent(page: Page) {
  return page.evaluate((key) => {
    const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
    return {
      schemaVersion: settings.schemaVersion,
      accent: settings.accent,
      customAccent: settings.customAccent,
    };
  }, SETTINGS_KEY);
}

function customTrigger(page: Page) {
  return page
    .locator("#settings-accent")
    .getByRole("button", { name: "Custom", exact: true });
}

async function openCustom(page: Page) {
  await customTrigger(page).click();
  const picker = page.getByRole("dialog", {
    name: "Custom accent color",
    exact: true,
  });
  await expect(picker).toBeVisible();
  return picker;
}

async function applyCustom(page: Page, color: string) {
  const picker = await openCustom(page);
  await picker
    .getByRole("textbox", { name: "HEX color", exact: true })
    .fill(color);
  await picker
    .getByRole("button", { name: "Apply color", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-accent", "custom");
  await expect(customTrigger(page)).toHaveAttribute("aria-pressed", "true");
}

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() =>
    [
      document.documentElement,
      document.body,
      document.querySelector("main")!,
    ].map((element) => ({
      name: element.tagName,
      visible: element.clientWidth,
      content: element.scrollWidth,
    })),
  );
  for (const width of widths)
    expect(
      width.content,
      `${width.name} has horizontal overflow`,
    ).toBeLessThanOrEqual(width.visible + 1);
}

async function primaryPixel(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim();
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].join(",");
  });
}

async function primaryButtonContrast(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  return button.evaluate(async (element) => {
    // 读取浏览器实际解析的控件颜色，等待 normal/hover 过渡结束后再取样。
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const background = [...context.getImageData(0, 0, 1, 1).data];
    context.fillStyle = style.color;
    context.globalAlpha = Number(style.opacity);
    context.fillRect(0, 0, 1, 1);
    const foreground = [...context.getImageData(0, 0, 1, 1).data];
    const luminance = (channels: number[]) =>
      channels.slice(0, 3).reduce((total, channel, index) => {
        const value = channel / 255;
        const linear =
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return total + linear * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
    const values = [luminance(background), luminance(foreground)];
    return {
      background,
      foreground,
      backgroundImage: style.backgroundImage,
      ratio: (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05),
    };
  });
}

test("custom accent normalizes, survives reload and preset switching, and cancels invalid drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto("./#/settings");
  await applyCustom(page, "#3ad");
  const expected = {
    schemaVersion: 6,
    accent: "custom",
    customAccent: "#33AADD",
  };
  await expect.poll(() => savedAccent(page)).toEqual(expected);
  const applied = await primaryPixel(page);
  await page.reload();
  await expect(customTrigger(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => primaryPixel(page)).toBe(applied);

  await page
    .locator("#settings-accent")
    .getByRole("button", { name: "Blue", exact: true })
    .click();
  await expect
    .poll(() => savedAccent(page))
    .toEqual({ ...expected, accent: "blue" });
  const picker = await openCustom(page);
  const hex = picker.getByRole("textbox", { name: "HEX color", exact: true });
  await expect(hex).toHaveValue("#33AADD");
  const colorInput = picker.getByLabel("Pick a color", { exact: true });
  await expect(colorInput).toHaveValue("#33aadd");
  await colorInput.fill("#ff00aa");
  await expect(hex).toHaveValue("#ff00aa");
  await hex.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(customTrigger(page)).toBeFocused();
  await expect
    .poll(() => savedAccent(page))
    .toEqual({ ...expected, accent: "blue" });

  const reopened = await openCustom(page);
  await expect(
    reopened.getByRole("textbox", { name: "HEX color", exact: true }),
  ).toHaveValue("#33AADD");
  await reopened
    .getByRole("button", { name: "Apply color", exact: true })
    .click();
  await expect.poll(() => savedAccent(page)).toEqual(expected);
  await expect.poll(() => primaryPixel(page)).toBe(applied);

  const invalid = await openCustom(page);
  const invalidHex = invalid.getByRole("textbox", {
    name: "HEX color",
    exact: true,
  });
  await invalidHex.fill("#12GGGG");
  await invalidHex.press("Enter");
  await expect(invalidHex).toHaveAttribute("aria-invalid", "true");
  await expect(invalid.getByRole("alert")).toBeVisible();
  await expect(invalid).toBeVisible();
  expect(await savedAccent(page)).toEqual(expected);
  expect(await primaryPixel(page)).toBe(applied);
  await invalidHex.press("Escape");
  await expect(invalid).toHaveCount(0);
  await expectNoPageOverflow(page);
  await page.reload();
  await expect(customTrigger(page)).toHaveAttribute("aria-pressed", "true");
  expect(await savedAccent(page)).toEqual(expected);
});

test("every preset remains selectable on a narrow page and has distinct light and dark colors", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto("./#/settings");
  const lightColors = new Map<string, string>();
  for (const theme of ["light", "dark"] as const) {
    await page
      .locator("#settings-theme")
      .getByRole("button", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    if (theme === "dark")
      await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    const colors = new Set<string>();
    for (const accent of PRESET_ACCENTS) {
      const name = accent[0]!.toUpperCase() + accent.slice(1);
      const choice = page
        .locator("#settings-accent")
        .getByRole("button", { name, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("html")).toHaveAttribute("data-accent", accent);
      await expect
        .poll(async () => (await savedAccent(page)).accent)
        .toBe(accent);
      const color = await primaryPixel(page);
      colors.add(color);
      if (theme === "light") lightColors.set(accent, color);
      else
        expect(color, `${accent} adjusts to the dark theme`).not.toBe(
          lightColors.get(accent),
        );
      await expectNoPageOverflow(page);
    }
    expect(colors.size, `${theme} presets have their own rendered colors`).toBe(
      PRESET_ACCENTS.length,
    );
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const color of ["#FFFFFF", "#000000", "#FFFF00", "#00FFFF"]) {
    test(`custom ${color} keeps primary buttons readable in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await seed(page, theme);
      await page.goto("./#/settings");
      await applyCustom(page, color);
      await expect
        .poll(() => savedAccent(page))
        .toEqual({
          schemaVersion: 6,
          accent: "custom",
          customAccent: color,
        });
      const tokens = await page.locator("html").evaluate((root) => {
        const style = getComputedStyle(root);
        return ["--custom-accent-light", "--custom-accent-dark"].map((token) =>
          style.getPropertyValue(token).trim(),
        );
      });
      for (const token of tokens) expect(token).toMatch(/^#[\dA-F]{6}$/i);
      expect(tokens[0]).not.toBe(tokens[1]);
      await expectNoPageOverflow(page);
      await page.goto("./#/components");
      const primary = page.getByRole("button", {
        name: "Remix the idea",
        exact: true,
      });
      await expect(primary).toBeVisible();
      await page.mouse.move(1, 1);
      const normal = await primaryButtonContrast(primary);
      await primary.hover();
      const hover = await primaryButtonContrast(primary);
      for (const [state, sample] of [
        ["normal", normal],
        ["hover", hover],
      ] as const) {
        expect(sample.backgroundImage).toBe("none");
        expect(sample.background[3], "primary background is opaque").toBe(255);
        expect(
          sample.ratio,
          `${color} ${theme} ${state}: ${JSON.stringify(sample)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await expectNoPageOverflow(page);
      await testInfo.attach("custom-accent-contrast", {
        body: JSON.stringify({ color, theme, tokens, normal, hover }, null, 2),
        contentType: "application/json",
      });
    });
  }
}

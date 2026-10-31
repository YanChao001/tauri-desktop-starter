/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { expect, test, type Locator, type Page } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

async function seed(page: Page, motion = "reduced") {
  await page.addInitScript(
    ({ key, motion }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 3,
          language: "en",
          theme: "light",
          background: "plain",
          motion,
        }),
      ),
    { key: `${appConfig.browserStorageNamespace}:settings`, motion },
  );
}

async function mediaPaused(locator: Locator) {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLMediaElement))
      throw new Error("Expected a local media player");
    return element.paused;
  });
}

test("controlled dialogs and search cancellation restore the keyboard position", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/settings");
  const reset = page.getByRole("button", {
    name: "Reset preferences",
    exact: true,
  });
  await reset.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reset).toBeFocused();

  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("theme");
  await search.press("ArrowDown");
  await expect(search).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
  await search.fill("radius");
  await search.press("Enter");
  await expect(page.locator("#settings-radius")).toBeFocused();

  await page.goto("./#/components");
  await page.getByRole("tab", { name: /Resource collection/ }).click();
  const resource = page
    .locator(".resource-card")
    .first()
    .locator("button")
    .first();
  await resource.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(resource).toBeFocused();
});

test("pausing shared-space motion keeps the original button and keyboard focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seed(page, "full");
  await page.goto("./#/motion");
  await page.getByRole("tab", { name: "Shared space", exact: true }).click();
  const option = page.locator(".lab-layout-tabs button").first();
  await option.focus();
  await expect(page.locator(".motion-lab")).toHaveAttribute(
    "data-paused",
    "false",
  );
  const original = await option.elementHandle();
  if (!original) throw new Error("The layout option did not mount");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".motion-lab")).toHaveAttribute(
    "data-paused",
    "true",
  );
  expect(await original.evaluate((element) => element.isConnected)).toBe(true);
  await expect(option).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".motion-lab")).toHaveAttribute(
    "data-paused",
    "false",
  );
  expect(await original.evaluate((element) => element.isConnected)).toBe(true);
  await expect(option).toBeFocused();
});

test("a wide Markdown table remains readable through local keyboard scrolling", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 880, height: 900 });
  await page.goto("./#/media");
  const columns = Array.from({ length: 12 }, (_, index) => `Column${index}`);
  await page
    .locator("#markdown-source")
    .fill(
      `|${columns.join("|")}|\n|${columns.map(() => "---").join("|")}|\n|${columns.map((_, index) => `value${index}`).join("|")}|`,
    );
  const table = page.getByRole("region", { name: "Markdown table" });
  expect(
    await table.evaluate((element) => element.scrollWidth),
  ).toBeGreaterThan(await table.evaluate((element) => element.clientWidth));
  await table.focus();
  await table.press("ArrowRight");
  await expect
    .poll(() => table.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await table.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(
    page.getByRole("columnheader", { name: "Column11" }),
  ).toBeInViewport();
  const previousTable = await table.elementHandle();
  const scrollLeft = await table.evaluate((element) => element.scrollLeft);
  await page
    .locator("#markdown-source")
    .fill(
      `|${columns.join("|")}|\n|${columns.map(() => "---").join("|")}|\n|${columns.map((_, index) => `value${index}`).join("|")}|\n\nUpdated preview`,
    );
  await expect(
    page.getByText("Updated preview", { exact: true }),
  ).toBeVisible();
  expect(await previousTable?.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect(await table.evaluate((element) => element.scrollLeft)).toBe(
    scrollLeft,
  );
  expect(
    await page
      .locator("main")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
});

test("changing media tabs pauses a real local player and never resumes it automatically", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/media");
  const rate = 8000;
  const samples = rate * 20;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  await page.locator("#media-file").setInputFiles({
    name: "review.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  const audio = page.locator("audio");
  await audio.scrollIntoViewIfNeeded();
  await audio.click();
  await audio.evaluate(async (element) => {
    if (!(element instanceof HTMLMediaElement))
      throw new Error("Expected a local media player");
    await element.play();
  });
  await expect.poll(() => mediaPaused(audio)).toBe(false);
  await page
    .getByRole("tab", { name: "Data visualization", exact: true })
    .click();
  await expect(audio).toBeHidden();
  await expect.poll(() => mediaPaused(audio)).toBe(true);
  await page
    .getByRole("tab", { name: "Content & attachments", exact: true })
    .click();
  await audio.scrollIntoViewIfNeeded();
  await expect(audio).toBeVisible();
  expect(await mediaPaused(audio)).toBe(true);
});

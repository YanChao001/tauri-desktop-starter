/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

async function seed(page: Page) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: `${appConfig.browserStorageNamespace}:settings`,
      value: {
        schemaVersion: 3,
        language: "en",
        theme: "light",
        motion: "reduced",
        background: "plain",
      },
    },
  );
}

// Playwright may scroll to the retry action. Compare layout coordinates within main,
// so an intentional scroll is not mistaken for content moving in the document flow.
async function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const main = element.closest("main");
    return {
      x: box.x + (main?.scrollLeft ?? 0),
      y: box.y + (main?.scrollTop ?? 0),
      width: box.width,
      height: box.height,
    };
  });
}

function sameBounds(
  actual: Awaited<ReturnType<typeof bounds>>,
  expected: Awaited<ReturnType<typeof bounds>>,
  state: string,
) {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${state}: ${key}`,
    ).toBeLessThanOrEqual(1);
  }
}

for (const width of [880, 1440]) {
  for (const layout of ["grid", "list"] as const) {
    test(`resource ${layout} keeps its bounds during loading, failure and retry at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seed(page);
      await page.goto("./#/components");
      await page.getByRole("tab", { name: /Resource collection/ }).click();
      if (layout === "list")
        await page.getByLabel("List view", { exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      const results = page.locator(".library-results");
      const content = results.locator(".library-content");
      await expect(results.locator(".resource-card, tbody tr")).toHaveCount(6);
      const normal = await bounds(results);
      expect(normal.height).toBeGreaterThan(100);

      await page
        .getByRole("button", { name: "Try error state", exact: true })
        .click();
      await expect(results.getByRole("alert")).toBeVisible();
      await expect(content).toHaveAttribute("inert", "");
      sameBounds(await bounds(results), normal, "failure");
      await results
        .getByRole("button", { name: "Retry loading", exact: true })
        .click();
      await expect(results.getByRole("progressbar")).toBeVisible();
      sameBounds(await bounds(results), normal, "retry loading");
      await expect(results.getByRole("progressbar")).toHaveCount(0);
      await expect(content).not.toHaveAttribute("inert", "");
      sameBounds(await bounds(results), normal, "retry completed");

      await page
        .getByRole("button", { name: "Try the loading state", exact: true })
        .click();
      await expect(results.getByRole("progressbar")).toBeVisible();
      sameBounds(await bounds(results), normal, "loading");
      await page
        .getByRole("button", { name: "Cancel loading", exact: true })
        .click();
      await expect(results.getByRole("progressbar")).toHaveCount(0);
      sameBounds(await bounds(results), normal, "cancelled");

      await page.getByPlaceholder("Search by name or content…").fill("Prism");
      await expect(results.locator(".resource-card, tbody tr")).toHaveCount(1);
      const filtered = await bounds(results);
      await page
        .getByRole("button", { name: "Try error state", exact: true })
        .click();
      await expect(results.getByRole("alert")).toBeVisible();
      sameBounds(await bounds(results), filtered, "filtered failure");
      const retry = results.getByRole("button", {
        name: "Retry loading",
        exact: true,
      });
      await expect(retry).toBeInViewport();
      await retry.click();
      await expect(results.getByRole("progressbar")).toBeVisible();
      sameBounds(await bounds(results), filtered, "filtered retry loading");
    });
  }

  test(`input validation and success keep the form bounds at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.goto("./#/components");
    const field = page.getByRole("textbox", {
      name: "Sample title (required)",
      exact: true,
    });
    await field.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const form = field.locator("xpath=ancestor::form");
    const normal = await bounds(form);
    await form
      .getByRole("button", { name: "Check input", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("Enter a title");
    sameBounds(await bounds(form), normal, "field validation");
    await field.fill("Keep this title");
    await form
      .getByRole("button", { name: "Check input", exact: true })
      .click();
    await expect(
      page.getByText("Check passed. Content stays on this page only.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(form.getByRole("status")).toHaveCount(0);
    sameBounds(await bounds(form), normal, "success toast");
  });
}

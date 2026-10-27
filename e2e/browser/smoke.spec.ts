/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import appConfig from "../../app.config.json" with { type: "json" };

const SETTINGS_KEY = `${appConfig.browserStorageNamespace}:settings`;
const browserFailures = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const failures: string[] = [];
  browserFailures.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy|violates.*directive/i.test(message.text())
    )
      failures.push(message.text());
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const failures = browserFailures.get(page) ?? [];
  if (failures.length)
    await testInfo.attach("browser-runtime-or-csp-errors", {
      body: JSON.stringify(failures, null, 2),
      contentType: "application/json",
    });
  expect(failures).toEqual([]);
});

test("production assets and HashRouter pages work below a project subpath", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/assets/") && response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("./#/components");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main h2").first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/desktop-demo\/#\/components$/);
  await expect(page.locator("main h2").first()).toBeVisible();
  await page.goto("./#/database");
  await expect(page.locator("main")).toContainText("desktop");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-runtime",
    "tauri",
  );
  expect(failures).toEqual([]);
});

test("browser preferences survive a real page reload in localStorage", async ({
  page,
}) => {
  await page.goto("./#/settings");
  await page
    .locator("#settings-theme")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = globalThis.localStorage.getItem(key);
        return raw ? (JSON.parse(raw).theme as unknown) : null;
      }, SETTINGS_KEY),
    )
    .toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page
      .locator("#settings-theme")
      .getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the local network fixture supports GET, keyboard POST, cache and offline state without remote traffic", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /https:\/\/(httpbin\.org|jsonplaceholder\.typicode\.com)/.test(
        request.url(),
      )
    )
      external.push(request.url());
  });
  await page.goto("./#/network");
  await page.getByRole("button", { name: "Get content", exact: true }).click();
  const result = page.getByRole("region", { name: "Returned content" });
  await expect(result).toContainText('"source": "fixture"');
  const json = result.locator('code[data-language="json"]');
  await expect(
    json.locator('[data-token="property"]').filter({ hasText: /^"source"$/ }),
  ).toBeVisible();
  await expect(
    json.locator('[data-token="string"]').filter({ hasText: /^"fixture"$/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View or refresh result", exact: true })
    .click();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Showing the recent result without a new request." }),
  ).toBeVisible();
  const message = page.getByRole("textbox", { name: "Content to send" });
  await message.fill("Keyboard fixture request");
  await message.press("Enter");
  await expect(result).toContainText("Keyboard fixture request");
  await page.getByRole("checkbox", { name: "Simulate offline" }).check();
  await expect(
    page.getByRole("button", { name: "Get content", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "View or refresh result", exact: true })
    .click();
  await expect(result).toContainText('"method": "GET"');
  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText:
        "Showing the last result offline. It may be out of date; no request was made.",
    }),
  ).toBeVisible();
  expect(external).toEqual([]);
});

test("keyboard opens and dismisses the command palette", async ({ page }) => {
  await page.goto("./#/network");
  await page.locator("main h2").focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("virtual scrolling reaches the last of 10,000 records with a bounded DOM and resets on filtering", async ({
  page,
}) => {
  await page.goto("./#/data-studio");
  await page.getByRole("checkbox", { name: "Continuous scrolling" }).check();
  const table = page.getByRole("region", { name: "Demo records" });
  await expect(table.getByRole("table")).toHaveAttribute(
    "aria-rowcount",
    "10001",
  );
  await table.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(table.getByText("Demo 10000", { exact: true })).toBeVisible();
  expect(await table.locator("tbody tr").count()).toBeLessThan(100);
  await page
    .getByRole("searchbox", { name: "Filter by name, email or team" })
    .fill("Demo 00007");
  await expect(table.getByText("Demo 00007", { exact: true })).toBeVisible();
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "2");
});

test("records a reproducible production navigation and table performance sample", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./#/data-studio");
  await expect(page.locator("main h2").first()).toBeVisible();
  const firstContent = await page.evaluate(() => ({
    observedAtMs: performance.now(),
    navigation: performance
      .getEntriesByType("navigation")
      .map((entry) => entry.toJSON()),
    paint: performance.getEntriesByType("paint").map((entry) => entry.toJSON()),
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  }));
  const table = page.getByRole("region", { name: "Demo records" });
  const name = table.getByRole("button", { name: "Name", exact: true });
  await name.click();
  const sortStart = await page.evaluate(() => performance.now());
  await name.click();
  await expect(table.locator("tbody tr").first()).toContainText("Demo 10000");
  const sortEnd = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now())),
        );
      }),
  );
  await page.getByRole("checkbox", { name: "Continuous scrolling" }).check();
  const scrollStart = await table.evaluate((element) => {
    const start = performance.now();
    element.scrollTop = element.scrollHeight;
    return start;
  });
  await expect(table.getByText("Demo 00001", { exact: true })).toBeVisible();
  const scrollEnd = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now())),
        );
      }),
  );
  const sample = {
    capturedAt: new Date().toISOString(),
    mode: "production dist-web, headless Chromium, project subpath /desktop-demo/, local fixture",
    records: 10000,
    browser: testInfo.project.name,
    ...firstContent,
    sortDescendingObservedMs: sortEnd - sortStart,
    scrollToFinalRowObservedMs: scrollEnd - scrollStart,
    renderedBodyRowsAfterScroll: await table.locator("tbody tr").count(),
    methodology: {
      clock:
        "Browser performance.now(), milliseconds relative to document navigation; navigation/paint use PerformanceEntry.toJSON().",
      firstContent:
        "Observed after Playwright confirms the route heading is visible. Includes test-harness scheduling and is not a universal startup benchmark.",
      sort: "From before Playwright clicks descending Name sort across 10,000 rows to the expected first row being visible plus two animation frames.",
      scroll:
        "From assigning scrollTop=scrollHeight to the final virtualized record being visible plus two animation frames.",
      interpretation:
        "One environment-specific sample, with no machine-independent timing threshold. Compare repeated samples on the same hardware/build when investigating regressions.",
    },
  };
  const path = testInfo.outputPath("performance.json");
  await writeFile(path, JSON.stringify(sample, null, 2));
  await testInfo.attach("production-performance-sample", {
    path,
    contentType: "application/json",
  });
});

for (const route of ["network", "data-studio", "media", "catalog"]) {
  test(`${route} has no detected WCAG A/AA accessibility violations`, async ({
    page,
  }, testInfo) => {
    await page.goto(`./#/${route}`);
    await expect(page.locator("main h2").first()).toBeVisible();
    if (route === "media") {
      await page
        .getByRole("tab", { name: "Data visualization", exact: true })
        .click();
      await expect(
        page.getByRole("img", { name: /One week of demo metrics/ }),
      ).toBeVisible();
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    if (result.violations.length)
      await testInfo.attach("accessibility-violations", {
        body: JSON.stringify(result.violations, null, 2),
        contentType: "application/json",
      });
    expect(result.violations).toEqual([]);
  });
}

for (const profile of [
  {
    name: "light-wide",
    width: 1280,
    theme: "light",
    sidebarWidth: 224,
    sidebarCollapsed: false,
    language: "en",
  },
  {
    name: "dark-wide",
    width: 1280,
    theme: "dark",
    sidebarWidth: 224,
    sidebarCollapsed: false,
    language: "en",
  },
  {
    name: "light-880-sidebar-360",
    width: 880,
    theme: "light",
    sidebarWidth: 360,
    sidebarCollapsed: false,
    language: "zh",
  },
  {
    name: "dark-narrow",
    width: 560,
    theme: "dark",
    sidebarWidth: 224,
    sidebarCollapsed: true,
    language: "zh",
  },
] as const) {
  test(`lab pages remain usable in ${profile.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: profile.width, height: 900 });
    await page.addInitScript(
      ({ key, settings }) => {
        globalThis.localStorage.setItem(
          key,
          JSON.stringify({ schemaVersion: 2, motion: "reduced", ...settings }),
        );
      },
      { key: SETTINGS_KEY, settings: profile },
    );
    for (const route of ["catalog", "network", "data-studio", "media"]) {
      await page.goto(`./#/${route}`);
      await expect(page.locator("main h2").first()).toBeVisible();
      if (route === "media") {
        await page
          .getByRole("tab", { name: /Data visualization|数据可视化/ })
          .click();
        await expect(
          page.getByRole("img", {
            name: /One week of demo metrics|一周演示指标/,
          }),
        ).toBeVisible();
      }
      await expect
        .poll(() =>
          page
            .locator("main")
            .evaluate((element) => element.scrollWidth - element.clientWidth),
        )
        .toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`${route}-${profile.name}.png`),
        animations: "disabled",
      });
      if (route === "media" || route === "data-studio") {
        await page
          .getByRole("tab", {
            name:
              route === "media"
                ? /Live connections|实时通信/
                : /Conditional form|条件表单/,
          })
          .click();
        await page.locator("main form").last().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`${route}-${profile.name}-details.png`),
          animations: "disabled",
        });
      }
    }
  });
}

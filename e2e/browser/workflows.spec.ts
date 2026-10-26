/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import appConfig from "../../app.config.json" with { type: "json" };

async function seed(page: Page, language = "en", theme = "light") {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: `${appConfig.browserStorageNamespace}:settings`,
      value: {
        schemaVersion: 3,
        language,
        theme,
        motion: "reduced",
        background: "plain",
      },
    },
  );
}
test("CSV errors require consent, exported data can be imported again, and replacement is explicit", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/data-studio");
  await page.getByText("Import, validate and export", { exact: true }).click();
  await page.getByRole("button", { name: "Load sample with errors" }).click();
  await expect(
    page.getByRole("button", { name: "Import valid records" }),
  ).toBeDisabled();
  await expect(
    page.getByText("2 valid rows, 1 invalid rows", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Import valid rows only and retain invalid rows in the report",
    })
    .check();
  await page.getByRole("button", { name: "Import valid records" }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all CSV" }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, "utf8");
  expect(csv).toContain('"Lin, Mei"');
  expect(csv).toContain("alex@example.test");
  expect(csv.trim().split(/\r?\n/)).toHaveLength(3);
  await page.getByLabel("CSV source (edit and check again)").fill(csv);
  await page.getByRole("button", { name: "Check and preview" }).click();
  await expect(
    page.getByText("2 valid rows, 0 invalid rows", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import valid records" }).click();
  await page.getByRole("button", { name: "Import valid records" }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Replace records that have not been exported?",
    }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByLabel("CSV source (edit and check again)"),
  ).toHaveValue(csv.replaceAll("\r\n", "\n"));
});

for (const locale of [
  {
    language: "en",
    theme: "light",
    heading: "Extensions",
    review: "Review a local Wasm package and its exported commands",
  },
  {
    language: "zh",
    theme: "dark",
    heading: "扩展中心",
    review: "审阅本地 Wasm 扩展包与导出命令",
  },
]) {
  test(`extension route preserves the browser boundary and narrow layout in ${locale.language}`, async ({
    page,
  }) => {
    await seed(page, locale.language, locale.theme);
    await page.setViewportSize({ width: 880, height: 600 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./#/extensions?journey=extensions&step=0");
    await expect(
      page.getByRole("heading", { name: locale.heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(locale.review, { exact: true })).toBeVisible();
    await expect(page.locator("#extension-package")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

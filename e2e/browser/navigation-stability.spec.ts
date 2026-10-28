/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

test("repeated sidebar navigation preserves the current page controls and draft", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 3,
        language: "en",
        motion: "reduced",
      }),
    );
  }, `${appConfig.browserStorageNamespace}:settings`);
  await page.goto("./#/components");

  const title = page.getByRole("textbox", {
    name: "Sample title (required)",
    exact: true,
  });
  const draft = "Keep this draft while selecting the current page";
  await title.fill(draft);
  const original = await title.evaluateHandle((element) => element);
  const sidebar = page.locator("#app-sidebar-navigation");
  const current = sidebar.getByRole("link", {
    name: "Playground",
    exact: true,
  });

  for (let repeat = 0; repeat < 3; repeat++) {
    await current.click();
    await expect(title).toHaveValue(draft);
    expect(
      await title.evaluate((element, node) => element === node, original),
    ).toBe(true);

    await current.press("Enter");
    await expect(title).toHaveValue(draft);
    expect(
      await title.evaluate((element, node) => element === node, original),
    ).toBe(true);
  }

  await sidebar.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(title).toHaveCount(0);
  expect(await original.evaluate((element) => element.isConnected)).toBe(false);

  // 普通页面的局部演示状态只在当前页面保留，离页后再次进入重新初始化。
  await current.click();
  await expect(title).toHaveValue("");
  expect(
    await title.evaluate((element, node) => element === node, original),
  ).toBe(false);
  await original.dispose();
});

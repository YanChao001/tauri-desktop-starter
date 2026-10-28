import { expect, test } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

test("另一个标签页的主题缓存不会覆盖当前偏好或引发主题反复切换", async ({
  page,
  context,
}) => {
  await page.goto("./#/settings");
  await page
    .locator("#settings-theme")
    .getByRole("button", { name: "Light", exact: true })
    .click();
  const other = await context.newPage();
  await other.goto("./#/settings");
  await expect(
    other
      .locator("#settings-theme")
      .getByRole("button", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const tab of [page, other])
    await tab.evaluate((key) => {
      document.documentElement.dataset.themeCacheEvents = "0";
      window.addEventListener("storage", (event) => {
        if (event.key === key)
          document.documentElement.dataset.themeCacheEvents = String(
            Number(document.documentElement.dataset.themeCacheEvents) + 1,
          );
      });
    }, `${appConfig.browserStorageNamespace}:theme`);
  await page
    .locator("#settings-theme")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  // 连续观察若干帧，覆盖另一标签页收到 storage 后的 React 提交。
  const themes = await other.evaluate(async () => {
    const values: boolean[] = [];
    for (let frame = 0; frame < 12; frame++) {
      await new Promise(requestAnimationFrame);
      values.push(document.documentElement.classList.contains("dark"));
    }
    return values;
  });
  expect(themes).toEqual(Array<boolean>(12).fill(false));
  for (const tab of [page, other])
    expect(
      Number(await tab.locator("html").getAttribute("data-theme-cache-events")),
    ).toBeLessThanOrEqual(1);
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}").theme,
      `${appConfig.browserStorageNamespace}:settings`,
    ),
  ).toBe("dark");
  await other.reload();
  await expect(other.locator("html")).toHaveClass(/dark/);
  await expect(
    other
      .locator("#settings-theme")
      .getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

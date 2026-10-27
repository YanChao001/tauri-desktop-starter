/// <reference lib="dom" />
import { expect, test } from "@playwright/test";

test("空工作台首屏不请求文档预览、冲突合并或语法高亮模块", async ({ page }) => {
  const deferredRequests: string[] = [];
  const routeRequests: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    if (/\/workbench-[^/]+\.js(?:\?|$)/.test(request.url()))
      routeRequests.push(request.url());
    if (
      /\/(?:document-preview|text-diff|typescript-code|code-block)-[^/]+\.js(?:\?|$)/.test(
        request.url(),
      )
    )
      deferredRequests.push(request.url());
  });
  await page.goto("./", { waitUntil: "networkidle" });
  await expect(page.locator("main h2").first()).toBeVisible();
  // 直接导航，避免侧栏的悬停预载掩盖首次进入的依赖。
  await page.evaluate(() => {
    location.hash = "/workbench";
  });
  await expect(
    page.getByRole("heading", { name: /^(文件工作台|File workbench)$/ }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(routeRequests.length).toBeGreaterThan(0);
  expect(deferredRequests).toEqual([]);
  expect(failures).toEqual([]);
});

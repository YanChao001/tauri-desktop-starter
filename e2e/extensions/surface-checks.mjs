import { expect } from "@playwright/test";

export async function checkChrome(page, profile, manifest) {
  const tools = page.getByRole("button", {
    name: profile.language === "zh" ? "扩展工具" : "Extension tools",
    exact: true,
  });
  await expect(page.locator("[data-extension-surface] header")).toHaveCount(0);
  await expect(page.locator(".app-main h1")).toHaveCount(0);
  const toolBox = await tools.boundingBox();
  if (profile.window === "true") {
    await expect(
      page.locator('[data-extension-chrome="titlebar"]').getByRole("button"),
    ).toHaveCount(1);
    const icon = page
      .locator(".app-title-bar")
      .getByRole("img", { name: manifest.name, exact: true });
    await expect(icon.locator("svg")).toBeVisible();
    const theme = await page.locator("[data-theme-control]").boundingBox();
    const minimize = await page
      .getByRole("button", {
        name: profile.language === "zh" ? "最小化" : "Minimize",
        exact: true,
      })
      .boundingBox();
    expect(theme.x + theme.width).toBeLessThanOrEqual(toolBox.x + 1);
    expect(toolBox.x + toolBox.width).toBeLessThanOrEqual(minimize.x + 1);
    return {
      placement: "titlebar",
      theme,
      tools: toolBox,
      minimize,
      manifestIcon: true,
    };
  }
  const navigation = page.locator("nav.app-route-context-extension");
  await expect(
    navigation
      .locator('[data-extension-chrome="navigation"]')
      .getByRole("button", {
        name: profile.language === "zh" ? "扩展工具" : "Extension tools",
        exact: true,
      }),
  ).toBeVisible();
  await expect(navigation.locator("svg").first()).toBeVisible();
  const box = await navigation.boundingBox();
  expect(box.x + box.width - toolBox.x - toolBox.width).toBeLessThanOrEqual(
    (16 * parseFloat(profile.font)) / 16,
  );
  return {
    placement: "navigation",
    navigation: box,
    tools: toolBox,
    manifestIcon: true,
  };
}

export async function checkNormalControls(frame, name, fontSize) {
  const selectors = {
    "scientific-calculator":
      '[data-action="save"],#load,[data-action="export"],[data-action="history-clear"],#fit,#zoom-in,#zoom-out',
    "lan-chat": "#start,#stop,#rename,#refresh,#send,#export",
    "wallpaper-browser": "#refresh,#import,#settings,#search",
    lab: '[data-action="todo-add"]',
  };
  const controls = await frame.locator(selectors[name]).evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getBoundingClientRect().height > 0)
      .map((node) => ({
        id: node.id,
        action: node.dataset.action,
        height: node.getBoundingClientRect().height,
        boxSizing: getComputedStyle(node).boxSizing,
        fontSize: getComputedStyle(node).fontSize,
      })),
  );
  for (const control of controls) {
    expect(control.boxSizing).toBe("border-box");
    expect(control.height).toBeCloseTo(parseFloat(fontSize) * 2, 0);
    expect(parseFloat(control.fontSize)).toBe(parseFloat(fontSize) * 0.875);
  }
  expect(controls.length).toBeGreaterThan(0);
  return controls;
}

export async function checkSelectPopup(frame, selector) {
  const select = frame.locator(selector);
  const originalValue = await select.inputValue();
  const original = await select.boundingBox();
  const options = await select
    .locator("option")
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (node) =>
            !node.disabled &&
            !(
              node.parentElement.tagName === "OPTGROUP" &&
              node.parentElement.disabled
            ),
        )
        .map((node) => node.value),
    );
  await select.evaluate((node) => {
    window.__selectInputEvents = [];
    for (const type of ["input", "change", "pointerdown", "mousedown"])
      node.addEventListener(type, (event) =>
        window.__selectInputEvents.push({
          type,
          defaultPrevented: event.defaultPrevented,
          value: node.value,
        }),
      );
  });
  await select.click();
  const popup = frame.locator("[data-starter-listbox]");
  await expect(popup).toHaveCount(1);
  await expect(popup).toBeVisible();
  const radius = await select.evaluate(
    (node) => getComputedStyle(node).borderRadius,
  );
  await expect(popup).toHaveCSS("border-radius", radius);
  await select.press("Home");
  await select.press("Escape");
  await expect(select).toHaveValue(originalValue);
  await expect(popup).toHaveCount(0);
  await select.press("Space");
  await expect(popup).toBeVisible();
  const target = options[0] === originalValue ? options.at(-1) : options[0];
  await select.press(target === options[0] ? "Home" : "End");
  await select.press("Enter");
  await expect(select).toHaveValue(target);
  await expect(popup).toHaveCount(0);
  const events = await select.evaluate(() => window.__selectInputEvents);
  expect(
    events.some(
      (event) => event.type === "pointerdown" && event.defaultPrevented,
    ),
  ).toBe(true);
  expect(
    events
      .filter((event) => event.type === "mousedown")
      .every((event) => event.defaultPrevented),
  ).toBe(true);
  if (target !== originalValue)
    expect(events.filter((event) => event.type === "change")).toHaveLength(1);
  await select.selectOption(originalValue);
  const after = await select.boundingBox();
  expect(after.height).toBeCloseTo(original.height, 0);
  return {
    selector,
    radius,
    escapeCancels: true,
    enterCommits: true,
    nativePopupDefaultPrevented: true,
    heightBefore: original.height,
    heightAfter: after.height,
  };
}

export async function checkToolsHelp(page, label) {
  const region = page.getByRole("region", { name: label, exact: true });
  await expect(region.locator('[data-slot="popover-description"]')).toHaveCount(
    0,
  );
  const info = region.locator("[data-extension-help]").first();
  await expect(info).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await info.evaluate((node) => {
    window.__helpTiming = {
      entered: 0,
      opened: 0,
      activeElement: document.activeElement?.getAttribute("aria-label"),
      leaves: [],
    };
    node.addEventListener("pointerleave", (event) =>
      window.__helpTiming.leaves.push({
        at: performance.now(),
        x: event.clientX,
        y: event.clientY,
      }),
    );
    node.addEventListener(
      "pointerenter",
      () => {
        window.__helpTiming.entered = performance.now();
        const sample = () => {
          const content = document.querySelector(
            '[data-slot="tooltip-content"]',
          );
          if (
            content &&
            content.getBoundingClientRect().height > 0 &&
            Number(getComputedStyle(content).opacity) > 0.01
          )
            window.__helpTiming.opened = performance.now();
          else if (performance.now() - window.__helpTiming.entered < 3000)
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { once: true },
    );
  });
  await info.hover();
  await expect(page.getByRole("tooltip")).toBeVisible({ timeout: 2000 });
  await expect
    .poll(() => page.evaluate(() => window.__helpTiming.opened))
    .toBeGreaterThan(0);
  const timing = await page.evaluate(() => window.__helpTiming);
  expect(timing.opened - timing.entered).toBeGreaterThanOrEqual(600);
  const box = await page.getByRole("tooltip").boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width - 12);
  const heading = await region
    .getByRole("heading", { name: label, exact: true })
    .boundingBox();
  await page.mouse.move(
    heading.x + heading.width / 2,
    heading.y + heading.height / 2,
    { steps: 6 },
  );
  await page.mouse.move(
    heading.x + heading.width / 2 - 2,
    heading.y + heading.height / 2,
  );
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  return {
    delayed: true,
    delayMs: timing.opened - timing.entered,
    width: box.width,
    noPermanentDescription: true,
  };
}

export async function frameGeometry(page) {
  return page.locator("iframe").evaluate((node) => ({
    y: node.getBoundingClientRect().y,
    height: node.getBoundingClientRect().height,
    bottom: node.getBoundingClientRect().bottom,
    viewport: innerHeight,
  }));
}
export function stableFrameGeometry(before, after) {
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
  expect(after.height).toBeGreaterThanOrEqual(240);
  expect(after.bottom).toBeLessThanOrEqual(after.viewport + 1);
}

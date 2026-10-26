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
    const title = page.locator("[data-extension-window-title]");
    await expect(title).toHaveText(manifest.name);
    await expect(title).toHaveAttribute("title", manifest.name);
    await expect(title).toBeVisible();
    const titleGeometry = await title.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      overflow: getComputedStyle(node).overflow,
      textOverflow: getComputedStyle(node).textOverflow,
      whiteSpace: getComputedStyle(node).whiteSpace,
    }));
    expect(titleGeometry.width).toBeGreaterThan(0);
    expect(titleGeometry.whiteSpace).toBe("nowrap");
    expect(titleGeometry.textOverflow).toBe("ellipsis");
    expect(titleGeometry.overflow).toBe("hidden");
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
      title: { text: manifest.name, ...titleGeometry },
    };
  }
  await expect(page.locator(".app-route-context")).toHaveCount(0);
  const sidebar = page.locator("#app-sidebar");
  const row = sidebar.locator("[data-sidebar-extension]");
  const link = row.locator("a.app-sidebar-link");
  const slot = row.locator('[data-extension-chrome="navigation"]');
  await expect(row).toHaveCount(1);
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(link.locator("svg")).toBeVisible();
  await expect(slot.getByRole("button")).toHaveCount(1);
  expect(await tools.evaluate((node) => node.closest("a") === null)).toBe(true);
  const originalTool = await tools.elementHandle();
  const originalFrame = await page.locator("iframe").elementHandle();
  await row.scrollIntoViewIfNeeded();
  const expandedLink = await link.boundingBox();
  const expandedTool = await tools.boundingBox();
  expect(expandedLink.x + expandedLink.width).toBeLessThanOrEqual(
    expandedTool.x + 1,
  );
  expect(
    Math.abs(
      expandedLink.y +
        expandedLink.height / 2 -
        expandedTool.y -
        expandedTool.height / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(tools).toBeFocused();
  await page
    .getByRole("button", {
      name: profile.language === "zh" ? "折叠侧栏" : "Collapse sidebar",
      exact: true,
    })
    .click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await row.scrollIntoViewIfNeeded();
  const collapsedSidebar = await sidebar.boundingBox();
  const collapsedLink = await link.boundingBox();
  const collapsedTool = await tools.boundingBox();
  expect(collapsedSidebar.width).toBe(56);
  expect(collapsedLink.y + collapsedLink.height).toBeLessThanOrEqual(
    collapsedTool.y + 1,
  );
  expect(collapsedTool.x).toBeGreaterThanOrEqual(collapsedSidebar.x);
  expect(collapsedTool.x + collapsedTool.width).toBeLessThanOrEqual(
    collapsedSidebar.x + collapsedSidebar.width,
  );
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(tools).toBeFocused();
  expect(await originalTool.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalFrame.evaluate((node) => node.isConnected)).toBe(true);
  await page
    .getByRole("button", {
      name: profile.language === "zh" ? "展开侧栏" : "Expand sidebar",
      exact: true,
    })
    .click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await row.scrollIntoViewIfNeeded();
  return {
    placement: "sidebar-navigation",
    expandedLink,
    expandedTool,
    collapsedSidebar,
    collapsedLink,
    collapsedTool,
    keyboardReachable: true,
    toolAndFrameRetained: true,
    toolsOutsideLink: true,
    manifestIcon: true,
  };
}

export async function checkNormalControls(frame, name, fontSize) {
  const selectors = {
    // 绘图操作组允许窄屏换行，由同组等高检查验证，不要求固定 2rem。
    "scientific-calculator":
      '[data-action="save"],#load,[data-action="export"],[data-action="history-clear"],#zoom-in,#zoom-out',
    "lan-chat": "#start,#stop,#rename,#refresh,#send,#export",
    "wallpaper-browser": "#refresh,#import,#settings",
    lab: '[data-action="todo-add"]',
  };
  const controls = [];
  for (const selector of selectors[name].split(",")) {
    const control = frame.locator(selector);
    await expect(control, `Required ordinary control ${selector}`).toHaveCount(
      1,
    );
    await expect(control, `Visible ordinary control ${selector}`).toBeVisible();
    const measured = await control.evaluate((node) => ({
      id: node.id,
      action: node.dataset.action,
      height: node.getBoundingClientRect().height,
      width: node.getBoundingClientRect().width,
      boxSizing: getComputedStyle(node).boxSizing,
      fontSize: getComputedStyle(node).fontSize,
    }));
    expect(measured.height, `Visible height of ${selector}`).toBeGreaterThan(0);
    expect(measured.width, `Visible width of ${selector}`).toBeGreaterThan(0);
    controls.push(measured);
  }
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
  const trigger = page.getByRole("button", { name: label, exact: true });
  await expect(
    page.getByRole("menu", { name: label, exact: true }),
  ).toHaveCount(0);
  await expect(trigger).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await trigger.evaluate((node) => {
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
  await trigger.hover();
  await expect(page.getByRole("tooltip")).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("tooltip")).toHaveText(label);
  await expect
    .poll(() => page.evaluate(() => window.__helpTiming.opened))
    .toBeGreaterThan(0);
  const timing = await page.evaluate(() => window.__helpTiming);
  expect(timing.opened - timing.entered).toBeGreaterThanOrEqual(600);
  const box = await page.getByRole("tooltip").boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width - 12);
  const destination = {
    x: page.viewportSize().width - 8,
    y: page.viewportSize().height - 8,
  };
  await page.mouse.move(destination.x, destination.y, { steps: 6 });
  await page.mouse.move(destination.x - 2, destination.y);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  return {
    delayed: true,
    delayMs: timing.opened - timing.entered,
    width: box.width,
    triggerOnly: true,
    noPermanentDescription: true,
  };
}

export async function frameGeometry(page) {
  return page.locator("iframe").evaluate((node) => ({
    x: node.getBoundingClientRect().x,
    width: node.getBoundingClientRect().width,
    right: node.getBoundingClientRect().right,
    y: node.getBoundingClientRect().y,
    height: node.getBoundingClientRect().height,
    bottom: node.getBoundingClientRect().bottom,
    viewport: innerHeight,
  }));
}

export async function checkHostScroll(page, profile) {
  const main = page.locator("main.app-main");
  await expect(main).toHaveAttribute("tabindex", "0");
  await expect
    .poll(() => main.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeLessThanOrEqual(1);
  const beforeMain =
    profile.window === "true"
      ? page.locator(".app-title-bar button").last()
      : page.locator('#app-sidebar [role="separator"]');
  await beforeMain.focus();
  await page.keyboard.press("Tab");
  await expect(main).toBeFocused();
  const geometry = await main.evaluate((node) => ({
    left: node.getBoundingClientRect().left + node.clientLeft,
    right:
      node.getBoundingClientRect().left + node.clientLeft + node.clientWidth,
    viewportWidth: innerWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootScrollHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    originalTop: node.scrollTop,
  }));
  const frameBox = await page.locator("iframe").boundingBox();
  expect(Math.abs(frameBox.x - geometry.left)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(frameBox.x + frameBox.width - geometry.right),
    "The iframe scrollbar belongs at the main region's right edge, including wide windows",
  ).toBeLessThanOrEqual(1);
  expect(geometry.rootScrollWidth).toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
  expect(geometry.rootScrollHeight).toBeLessThanOrEqual(
    geometry.viewportHeight + 1,
  );
  const frameScroll = await page
    .frameLocator("iframe")
    .locator("html")
    .evaluate(() => {
      const node = document.scrollingElement;
      const originalTop = node.scrollTop;
      node.scrollTop = node.scrollHeight;
      const result = {
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        maximumTop: Math.max(0, node.scrollHeight - node.clientHeight),
        reachedTop: node.scrollTop,
      };
      node.scrollTop = originalTop;
      return result;
    });
  expect(
    Math.abs(frameScroll.reachedTop - frameScroll.maximumTop),
  ).toBeLessThanOrEqual(1);
  return {
    ...geometry,
    tabReachable: true,
    hostOverflow: false,
    fullWidthSurface: true,
    frameBox,
    frameScroll,
  };
}

export async function checkPermissionConsent(
  page,
  manifest,
  language,
  capturePath,
) {
  const labels =
    language === "zh"
      ? {
          manage: "管理权限",
          group: "可选权限",
          all: "全选可选权限",
          cancel: "取消",
        }
      : {
          manage: "Manage permissions",
          group: "Optional capabilities",
          all: "Select all optional capabilities",
          cancel: "Cancel",
        };
  const card = page.locator("article").filter({
    has: page.getByRole("button", {
      name:
        language === "zh" ? `打开 ${manifest.name}` : `Open ${manifest.name}`,
      exact: true,
    }),
  });
  await card.getByRole("button", { name: labels.manage, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const group = dialog.getByRole("group", { name: labels.group, exact: true });
  const all = group.getByRole("checkbox", { name: labels.all, exact: true });
  const individual = group.locator("li").getByRole("checkbox");
  await expect(individual).toHaveCount(manifest.optionalPermissions.length);
  await expect(all).toBeVisible();
  const alignment = await group.locator("label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const checkbox = node.querySelector('[role="checkbox"]');
      const text = node.querySelector(":scope > span");
      const box = checkbox.getBoundingClientRect();
      const span = text.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      return {
        checkboxTop: box.top,
        checkboxHeight: box.height,
        textTop: span.top,
        textHeight: span.height,
        lineHeight,
        gap: span.left - box.right,
        alignmentError: Math.abs(
          box.top - span.top - (lineHeight - box.height) / 2,
        ),
      };
    }),
  );
  for (const row of alignment) {
    expect(row.alignmentError).toBeLessThanOrEqual(1);
    expect(row.gap).toBeGreaterThan(0);
  }
  if (
    page.viewportSize().width <= 400 &&
    manifest.optionalPermissions.length > 1
  )
    expect(alignment.some((row) => row.textHeight > row.lineHeight + 1)).toBe(
      true,
    );
  if ((await all.getAttribute("aria-checked")) === "true") await all.click();
  await all.click();
  await expect(all).toBeChecked();
  for (const permission of await individual.all())
    await expect(permission).toBeChecked();
  await individual.first().click();
  await expect(all).toHaveAttribute(
    "aria-checked",
    manifest.optionalPermissions.length > 1 ? "mixed" : "false",
  );
  await all.click();
  await expect(all).toBeChecked();
  await all.click();
  await expect(all).not.toBeChecked();
  for (const permission of await individual.all())
    await expect(permission).not.toBeChecked();
  if (capturePath) await page.screenshot({ path: capturePath });
  await dialog
    .getByRole("button", { name: labels.cancel, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  return {
    optionalCount: manifest.optionalPermissions.length,
    selectionStates:
      manifest.optionalPermissions.length > 1
        ? ["false", "true", "mixed"]
        : ["false", "true"],
    alignment,
    nativePermissionApproval: false,
  };
}

export async function checkWallpaperCapabilityBoundaries(page, frame, mode) {
  await expect(frame.locator("#network-mode")).toHaveValue("direct");
  const missingPermission = await frame
    .locator("html")
    .evaluate(async (_node, profile) => {
      try {
        await starter.services.request("resources", {
          action: "fetch-image",
          url: "https://images.wikipedia.org/one.jpg",
          networkMode: profile === "direct" ? "system" : "direct",
        });
        return null;
      } catch (error) {
        return error.code;
      }
    }, mode);
  expect(missingPermission).toBe("EXTENSION_UNAVAILABLE");
  if (mode === "denied") {
    await expect(frame.locator("#search")).toBeDisabled();
    const missingLinks = await frame.locator("html").evaluate(async () => {
      try {
        await starter.services.request("links", {
          url: "https://www.wikipedia.org/one",
        });
        return null;
      } catch (error) {
        return error.code;
      }
    });
    expect(missingLinks).toBe("EXTENSION_UNAVAILABLE");
    await frame.locator("#local-tab").click();
    const card = frame.locator("#gallery [data-wallpaper-id]").first();
    await expect(card.locator("h2")).toHaveText("Fixture local image");
    await expect(frame.locator("#import")).toBeEnabled();
    await card.locator('[data-action="apply"]').click();
    await expect(card).toHaveClass(/active/);
    await card.locator('[data-action="rename"]').click();
    await frame.locator("#rename-value").fill("Offline local image");
    await frame.locator("#dialog-confirm").click();
    await expect(card.locator("h2")).toHaveText("Offline local image");
    await frame.locator("#import").click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "已取消导入。" }),
    ).toBeVisible();
    await card.locator('[data-action="remove"]').click();
    await frame.locator("#dialog-confirm").click();
    await expect(frame.locator("#gallery [data-wallpaper-id]")).toHaveCount(0);
  } else {
    await expect(frame.locator("#search")).toBeEnabled();
    await frame.locator("#query").fill("landscape");
    await frame.locator("#search").click();
    await expect(frame.locator("#results .result")).toHaveCount(2, {
      timeout: 60000,
    });
    if (mode === "links-only") {
      const resourcesBeforeSelection = await page.evaluate(
        () =>
          window.__extensionUiTest.serviceCalls.filter(
            (call) => call.service === "resources",
          ).length,
      );
      await frame.locator("#results .result").first().click();
      await expect(frame.locator("#preview h2")).toHaveText(
        "Fixture landscape",
      );
      await expect(frame.locator("#preview-image")).toHaveCount(0);
      await expect(frame.locator("#download-original")).toBeDisabled();
      await expect(frame.locator("#add-to-gallery")).toBeDisabled();
      await expect(frame.locator("#open-source")).toBeEnabled();
      await frame.locator("#open-source").click();
      await page.evaluate(() =>
        window.__extensionSettingsTest.update({ language: "en" }),
      );
      await expect(frame.locator("html")).toHaveAttribute("lang", "en");
      await expect(frame.locator("#preview h2")).toHaveText(
        "Fixture landscape",
      );
      await expect(frame.locator("#open-source")).toBeEnabled();
      expect(
        await page.evaluate(
          () =>
            window.__extensionUiTest.serviceCalls.filter(
              (call) => call.service === "resources",
            ).length,
        ),
      ).toBe(resourcesBeforeSelection);
    }
  }
  return {
    permissionProfile: mode,
    missingPermission,
    localGalleryAvailable: mode === "denied",
    sourceLinksWithoutImagePermission: mode === "links-only",
    nativeServices: false,
  };
}

export function stableFrameGeometry(before, after) {
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
  expect(after.height).toBeGreaterThan(0);
  expect(after.bottom).toBeLessThanOrEqual(after.viewport + 1);
}

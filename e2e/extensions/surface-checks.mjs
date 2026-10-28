import { expect } from "@playwright/test";

export async function checkWindowSkin(page, frame, inheritsSkin, screenshot) {
  const previous = await page.evaluate(() => {
    const { background, backgroundIntensity } =
      window.__extensionSettingsTest.read();
    return { background, backgroundIntensity };
  });
  const backgrounds = () =>
    frame.locator("html").evaluate((root) =>
      [root, root.ownerDocument.body].map((node) => {
        const style = getComputedStyle(node);
        return [style.backgroundColor, style.backgroundImage];
      }),
    );
  const before = await backgrounds();
  try {
    await page.evaluate(() =>
      window.__extensionSettingsTest.update({
        background: "aurora",
        backgroundIntensity: 50,
      }),
    );
    await expect(
      page.locator(
        '[data-window-background] [data-pattern="aurora"] .skin-scene',
      ),
    ).toBeVisible();
    const muted = await page
      .locator("html")
      .evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--muted-foreground").trim(),
      );
    await expect
      .poll(() =>
        frame
          .locator("html")
          .evaluate((node) =>
            getComputedStyle(node)
              .getPropertyValue("--muted-foreground")
              .trim(),
          ),
      )
      .toBe(muted);
    expect(await backgrounds()).toEqual(before);
    if (inheritsSkin)
      for (const selector of ["html", "body"])
        await expect(frame.locator(selector)).toHaveCSS(
          "background-color",
          "rgba(0, 0, 0, 0)",
        );
    const surfaceSelector =
      ".studio-console,.inspector,.side-panel,.scene-footer,.flow-results,button.result,.card";
    const surfaceAlpha = () =>
      frame.locator(surfaceSelector).evaluateAll((nodes) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        return nodes.map((node) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = getComputedStyle(node).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3];
        });
      });
    if (inheritsSkin) {
      expect(await frame.locator(surfaceSelector).count()).toBeGreaterThan(0);
      for (const intensity of [0, 50, 100]) {
        await page.evaluate(
          (backgroundIntensity) =>
            window.__extensionSettingsTest.update({ backgroundIntensity }),
          intensity,
        );
        const alpha = Math.round(255 * (1 - (intensity / 100) ** 4));
        await expect
          .poll(async () =>
            (await surfaceAlpha()).every((value) => value === alpha),
          )
          .toBe(true);
        expect(await backgrounds()).toEqual(before);
      }
      await page.evaluate(() =>
        window.__extensionSettingsTest.update({ backgroundIntensity: 50 }),
      );
      await expect
        .poll(async () =>
          (await surfaceAlpha()).every((value) => value === 239),
        )
        .toBe(true);
    }
    await page.screenshot({ path: screenshot });
    return {
      background: "aurora",
      inheritsSkin,
      authorBackgroundPreserved: true,
      sharedSurfaceEndpoints: inheritsSkin,
    };
  } finally {
    await page.evaluate(
      (settings) => window.__extensionSettingsTest.update(settings),
      previous,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-background",
      previous.background,
    );
  }
}

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
  if (
    name === "scientific-calculator" &&
    (await frame.locator("main").getAttribute("data-mode")) !== "scientific"
  ) {
    await frame.locator("#navigation").click();
    await frame.locator("#scientific-mode").click();
  }
  const selectors = {
    // 计算器采用 Windows 风格的自定按键布局，菜单项与折叠面板另验入口。
    "scientific-calculator":
      '#navigation,#angle-cycle,#keypad button[data-key="equals"]',
    "lan-chat":
      "#settings-toggle,#refresh,#emoji-toggle,#send-image,#send-file,#send",
    "wallpaper-browser": "#refresh,#import,#settings",
    lab: "#canvas-add",
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
    if (name === "lan-chat" || name === "scientific-calculator") {
      // 聊天工具栏刻意使用紧凑尺寸；验证可操作区域，不将 SDK 默认高度锁死。
      expect(control.height).toBeGreaterThanOrEqual(24);
      expect(control.width).toBeGreaterThanOrEqual(24);
      expect(parseFloat(control.fontSize)).toBeGreaterThanOrEqual(11);
    } else {
      expect(control.height).toBeCloseTo(parseFloat(fontSize) * 2, 0);
      expect(parseFloat(control.fontSize)).toBe(parseFloat(fontSize) * 0.875);
    }
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
    bottom:
      node.getBoundingClientRect().top + node.clientTop + node.clientHeight,
    viewportWidth: innerWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootScrollHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    originalTop: node.scrollTop,
  }));
  const frameBox = await page.locator("iframe").boundingBox();
  const frameBottom = frameBox.y + frameBox.height;
  const bottomGap = geometry.bottom - frameBottom;
  expect(Math.abs(frameBox.x - geometry.left)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(frameBox.x + frameBox.width - geometry.right),
    "The iframe scrollbar belongs at the main region's right edge, including wide windows",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(bottomGap),
    "The iframe fills the main region to its bottom edge: " +
      JSON.stringify({
        mainBottom: geometry.bottom,
        mainHeight: geometry.clientHeight,
        frameBottom,
        frameBox,
        bottomGap,
      }),
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
    fullHeightSurface: true,
    frameBottom,
    bottomGap,
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
          moreActions: `${manifest.name}的更多操作`,
          group: "你可以选择允许",
          all: "允许所有可选权限",
          cancel: "取消",
        }
      : {
          manage: "Manage permissions",
          moreActions: `More actions for ${manifest.name}`,
          group: "You can choose to allow",
          all: "Allow all optional permissions",
          cancel: "Cancel",
        };
  const card = page.locator("article").filter({
    has: page.getByRole("button", {
      name: labels.moreActions,
      exact: true,
    }),
  });
  await expect(card).toHaveCount(1);
  await card
    .getByRole("button", { name: labels.moreActions, exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: labels.manage, exact: true })
    .click();
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

export async function checkWallpaperDiscoveryLayout(frame) {
  const layout = await frame.locator("html").evaluate(() => {
    const bounds = (node) => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        center: box.top + box.height / 2,
      };
    };
    const form = document.getElementById("search-form");
    return {
      viewport: innerWidth,
      tabs: bounds(document.querySelector('[role="tablist"]')),
      settings: bounds(document.getElementById("settings")),
      form: bounds(form),
      controls: [
        "provider",
        "source-help-button",
        "category",
        "query",
        "search",
      ].map((id) => ({
        id,
        inForm: form.contains(document.getElementById(id)),
        ...bounds(document.getElementById(id)),
      })),
    };
  });
  expect(
    Math.abs(layout.tabs.center - layout.settings.center),
  ).toBeLessThanOrEqual(1);
  const rows = [];
  for (const control of layout.controls) {
    expect(control.inForm).toBe(true);
    expect(control.width).toBeGreaterThan(0);
    expect(control.height).toBeGreaterThan(0);
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(layout.viewport);
    if (!rows.some((center) => Math.abs(center - control.center) <= 2))
      rows.push(control.center);
  }
  for (let index = 1; index < layout.controls.length; index++) {
    const previous = layout.controls[index - 1],
      current = layout.controls[index];
    if (Math.abs(previous.center - current.center) <= 2) {
      expect(current.left - previous.right).toBeGreaterThanOrEqual(-1);
      expect(current.left - previous.right).toBeLessThanOrEqual(16);
    } else {
      expect(current.top - previous.bottom).toBeGreaterThanOrEqual(-1);
      expect(current.top - previous.bottom).toBeLessThanOrEqual(16);
    }
  }
  expect(rows.length).toBeLessThanOrEqual(layout.viewport >= 840 ? 1 : 3);
  expect(layout.form.height).toBeLessThanOrEqual(
    Math.max(...layout.controls.map((control) => control.height)) * 3 + 32,
  );
  return { ...layout, rows: rows.length };
}

export async function checkWallpaperHelp(frame, fontSize) {
  const trigger = frame.locator("#source-help-button");
  const tooltip = frame.locator("#source-note");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();
  const geometry = await trigger.evaluate((node) => {
    const icon = node.querySelector("svg");
    const button = node.getBoundingClientRect();
    const glyph = icon.getBoundingClientRect();
    return {
      width: button.width,
      height: button.height,
      iconWidth: glyph.width,
      iconHeight: glyph.height,
      background: getComputedStyle(node).backgroundColor,
      text: node.textContent.trim(),
    };
  });
  expect(geometry.width).toBe(parseFloat(fontSize) * 1.5);
  expect(geometry.height).toBe(parseFloat(fontSize) * 1.5);
  expect(geometry.iconWidth).toBe(parseFloat(fontSize) * 0.875);
  expect(geometry.iconHeight).toBe(parseFloat(fontSize) * 0.875);
  expect(geometry.text).toBe("");
  const popup = await tooltip.evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    viewport: innerWidth,
  }));
  expect(popup.left).toBeGreaterThanOrEqual(0);
  expect(popup.right).toBeLessThanOrEqual(popup.viewport);
  await trigger.press("Escape");
  await expect(tooltip).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.press("Tab");
  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await trigger.press("Escape");
  await trigger.press("Tab");
  return {
    ...geometry,
    popup,
    keyboardHelp: true,
    escapeDismisses: true,
    focusRetained: true,
  };
}

export async function checkWallpaperCardActions(frame, card, fontSize) {
  await expect(frame.locator("#wallpaper-menu")).toHaveCount(0);
  await expect(card.locator('[data-action="wallpaper-menu"]')).toHaveCount(0);
  const apply = card.locator('[data-action="apply"]');
  const rename = card.locator('[data-action="rename"]');
  const remove = card.locator('[data-action="remove"]');
  await expect(apply.locator("img")).toBeVisible();
  await expect(apply).toHaveAttribute("aria-pressed", /^(true|false)$/);
  const name = (await card.locator("h2").textContent()).trim();
  for (const control of [apply, rename, remove]) {
    await expect(control).toHaveAccessibleName(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await expect(control).toBeEnabled();
  }
  for (const icon of [rename, remove]) {
    await expect(icon).toHaveAttribute("title", /.+/);
    await expect(icon.locator("svg")).toHaveCount(1);
    expect((await icon.textContent()).trim()).toBe("");
  }
  const geometry = await card.evaluate((node) => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        center: box.top + box.height / 2,
        width: box.width,
        height: box.height,
      };
    };
    return {
      card: rect(node),
      title: rect(node.querySelector("h2")),
      rename: rect(node.querySelector('[data-action="rename"]')),
      remove: rect(node.querySelector('[data-action="remove"]')),
      imageApply: !!node.querySelector('[data-action="apply"] img'),
    };
  });
  for (const icon of [geometry.rename, geometry.remove]) {
    expect(Math.abs(icon.center - geometry.title.center)).toBeLessThanOrEqual(
      1,
    );
    expect(icon.width).toBeCloseTo(icon.height, 1);
    expect(icon.height).toBeGreaterThanOrEqual(parseFloat(fontSize) * 1.5);
    expect(icon.right).toBeLessThanOrEqual(geometry.card.right);
  }
  expect(geometry.rename.left).toBeGreaterThanOrEqual(geometry.title.right - 1);
  expect(geometry.remove.left).toBeGreaterThanOrEqual(
    geometry.rename.right - 1,
  );
  await apply.focus();
  await apply.press("Tab");
  await expect(rename).toBeFocused();
  await rename.press("Tab");
  await expect(remove).toBeFocused();
  await remove.press("Shift+Tab");
  await expect(rename).toBeFocused();
  return { ...geometry, keyboardReachable: true, iconOnlyActions: true };
}

export async function checkWallpaperLocalGallery(page, frame, capturePath) {
  await frame.locator("#local-tab").click();
  const card = frame.locator("#gallery [data-wallpaper-id]").first();
  await expect(card.locator("h2")).toHaveText("Fixture local image");
  await expect(frame.locator("#import")).toBeEnabled();
  const actions = await checkWallpaperCardActions(
    frame,
    card,
    await frame
      .locator("html")
      .evaluate((node) => getComputedStyle(node).fontSize),
  );
  if (capturePath) await card.screenshot({ path: capturePath });
  await card.locator('[data-action="apply"]').click();
  await expect(card).toHaveClass(/active/);
  await expect(card.locator('[data-action="apply"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(card.locator('[data-action="apply"]')).toBeFocused();
  if (await frame.locator("html").evaluate(() => innerWidth <= 400)) {
    await frame.locator("h1").hover();
    await expect(page.locator("[data-sonner-toast]").last()).not.toBeVisible({
      timeout: 10000,
    });
  }
  await card.locator('[data-action="rename"]').click();
  await frame.locator("#rename-value").fill("Cancelled local draft");
  await frame.locator("#dialog-cancel").click();
  await expect(card.locator("h2")).toHaveText("Fixture local image");
  await expect(card.locator('[data-action="rename"]')).toBeFocused();
  await card.locator('[data-action="rename"]').click();
  await frame.locator("#rename-value").fill("Offline local image");
  await frame.locator("#dialog-confirm").click();
  await expect(card.locator("h2")).toHaveText("Offline local image");
  await expect(card.locator('[data-action="rename"]')).toBeFocused();
  await frame.locator("#import").click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "已取消导入。" }),
  ).toBeVisible();
  if (await frame.locator("html").evaluate(() => innerWidth <= 400)) {
    await frame.locator("h1").hover();
    await expect(page.locator("[data-sonner-toast]").last()).not.toBeVisible({
      timeout: 10000,
    });
  }
  await card.locator('[data-action="remove"]').click();
  await frame.locator("#dialog-cancel").click();
  await expect(card.locator('[data-action="remove"]')).toBeFocused();
  await card.locator('[data-action="remove"]').click();
  await frame.locator("#dialog-confirm").click();
  await expect(frame.locator("#gallery [data-wallpaper-id]")).toHaveCount(0);
  await expect(frame.locator("#import")).toBeFocused();
  return {
    actions,
    appliedViaImage: true,
    renameCancelFocus: true,
    renameConfirmFocus: true,
    removeCancelFocus: true,
    removalFocusesImport: true,
  };
}

export async function checkWallpaperCapabilityBoundaries(page, frame, mode) {
  await expect(frame.locator("#network-mode")).toHaveCount(0);
  const missingPermission = await frame
    .locator("html")
    .evaluate(async (_node, profile) => {
      try {
        await starter.services.request("resources", {
          action: "fetch-image",
          url: "https://images.unsplash.com/fixture-upx8-1.jpg",
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
          url: "https://wp.upx8.com/",
        });
        return null;
      } catch (error) {
        return error.code;
      }
    });
    expect(missingLinks).toBe("EXTENSION_UNAVAILABLE");
    await checkWallpaperLocalGallery(page, frame);
  } else {
    await expect(frame.locator("#search")).toBeEnabled();
    await expect(frame.locator("#results .result")).toHaveCount(24, {
      timeout: 60000,
    });
    if (mode === "direct")
      await expect(frame.locator("#results .result img")).toHaveCount(24, {
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
      await expect(frame.locator("#preview-dialog")).toBeVisible();
      await expect(frame.locator("#preview-image")).not.toBeVisible();
      await expect(frame.locator("#download-original")).toBeDisabled();
      await expect(frame.locator("#add-to-gallery")).toBeDisabled();
      await expect(frame.locator("#open-source")).toBeEnabled();
      await frame.locator("#open-source").click();
      await page.evaluate(() =>
        window.__extensionSettingsTest.update({ language: "en" }),
      );
      await expect(frame.locator("html")).toHaveAttribute("lang", "en");
      await expect
        .poll(
          () =>
            frame.locator("html").evaluate(() => window.__sdkSnapshot?.busy),
          { timeout: 60000 },
        )
        .toBe(false);
      await expect(frame.locator("#preview-dialog")).toBeVisible();
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

export async function checkWallpaperPreview(
  page,
  frame,
  language,
  capturePrefix,
) {
  await expect(frame.locator("#results .result")).toHaveCount(24, {
    timeout: 60000,
  });
  await expect
    .poll(
      () =>
        frame
          .locator("#results .result img")
          .evaluateAll(
            (images) =>
              images.filter((image) => image.complete && image.naturalWidth > 0)
                .length,
          ),
      { timeout: 60000 },
    )
    .toBe(24);
  const card = frame.locator("#results .result").nth(1);
  const dialog = frame.locator("#preview-dialog"),
    info = frame.locator("#image-info-dialog");
  const infoTrigger = frame.locator("#preview-info"),
    infoClose = frame.locator("#image-info-close");
  const mainGeometry = () =>
    dialog.evaluate((node) => {
      const bounds = (element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        };
      };
      return {
        dialog: bounds(node),
        stage: bounds(document.getElementById("preview-stage")),
        image: bounds(document.getElementById("preview-image")),
        actions: bounds(document.getElementById("preview-actions")),
      };
    });
  await card.focus();
  await card.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(frame.locator("#preview-image")).toBeVisible();
  await expect(frame.locator("#preview-subtitle")).toHaveCount(0);
  await expect(infoTrigger).toHaveAccessibleName(
    language === "en" ? "Image details" : "图片信息",
  );
  await expect(infoTrigger).toHaveAttribute("aria-haspopup", "dialog");
  const header = await dialog.locator(".preview-head").evaluate((node) => {
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    const children = ["preview-title", "preview-info", "preview-close"].map(
      (id) => {
        const child = document.getElementById(id),
          rect = child.getBoundingClientRect();
        return { id, center: rect.top + rect.height / 2, height: rect.height };
      },
    );
    return {
      height: box.height,
      padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      children,
    };
  });
  expect(
    Math.max(...header.children.map((child) => child.center)) -
      Math.min(...header.children.map((child) => child.center)),
  ).toBeLessThanOrEqual(1);
  expect(header.height).toBeLessThanOrEqual(
    Math.max(...header.children.map((child) => child.height)) +
      header.padding +
      2,
  );
  const labels =
    language === "en"
      ? ["Add to gallery", "Save original", "Source"]
      : ["加入图库", "下载原图", "来源"];
  const actionIds = ["add-to-gallery", "download-original", "open-source"];
  for (let index = 0; index < actionIds.length; index++)
    await expect(
      frame.locator("#" + actionIds[index]).locator(".action-label"),
    ).toHaveText(labels[index]);
  const actions = await frame
    .locator("#preview-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const label = button.querySelector(".action-label"),
          box = button.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          overflow: button.scrollWidth - button.clientWidth,
          labelOverflow: label.scrollWidth - label.clientWidth,
          labelHeightOverflow: label.scrollHeight - label.clientHeight,
          ellipsis: getComputedStyle(label).textOverflow,
          text: label.textContent,
        };
      }),
    );
  expect(actions).toHaveLength(3);
  expect(
    Math.max(...actions.map((action) => action.height)) -
      Math.min(...actions.map((action) => action.height)),
  ).toBeLessThanOrEqual(1);
  for (const action of actions) {
    expect(action.overflow).toBeLessThanOrEqual(1);
    expect(action.labelOverflow).toBeLessThanOrEqual(1);
    expect(action.labelHeightOverflow).toBeLessThanOrEqual(1);
    expect(action.ellipsis).not.toBe("ellipsis");
    expect(action.text).not.toMatch(/…|\.\.\./);
  }
  const beforeInfo = await mainGeometry();
  if (capturePrefix)
    await page.screenshot({ path: capturePrefix + "-preview.png" });
  await infoTrigger.focus();
  await infoTrigger.press("Enter");
  await expect(info).toBeVisible();
  await expect(infoClose).toBeFocused();
  const afterInfo = await mainGeometry();
  for (const element of Object.keys(beforeInfo))
    for (const key of Object.keys(beforeInfo[element]))
      expect(
        Math.abs(beforeInfo[element][key] - afterInfo[element][key]),
      ).toBeLessThanOrEqual(1);
  const infoGeometry = await info.evaluate((node) => {
    const box = node.getBoundingClientRect(),
      body = document.getElementById("image-info-body");
    body.scrollTop = body.scrollHeight;
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      maximumScroll: Math.max(0, body.scrollHeight - body.clientHeight),
      reachedScroll: body.scrollTop,
    };
  });
  expect(infoGeometry.left).toBeGreaterThanOrEqual(0);
  expect(infoGeometry.right).toBeLessThanOrEqual(infoGeometry.viewportWidth);
  expect(infoGeometry.top).toBeGreaterThanOrEqual(0);
  expect(infoGeometry.bottom).toBeLessThanOrEqual(infoGeometry.viewportHeight);
  expect(infoGeometry.bodyOverflow).toBeLessThanOrEqual(1);
  expect(
    Math.abs(infoGeometry.maximumScroll - infoGeometry.reachedScroll),
  ).toBeLessThanOrEqual(1);
  if (capturePrefix)
    await page.screenshot({ path: capturePrefix + "-info.png" });
  await infoClose.press("Escape");
  await expect(info).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(infoTrigger).toBeFocused();
  await frame.locator("#preview-close").press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(card).toBeFocused();
  await card.press("Space");
  await infoTrigger.click();
  await expect(info).toBeVisible();
  await infoClose.click();
  await expect(info).not.toBeVisible();
  await expect(infoTrigger).toBeFocused();
  await frame.locator("#preview-close").click();
  await expect(dialog).not.toBeVisible();
  await expect(card).toBeFocused();
  return {
    header,
    actions,
    beforeInfo,
    afterInfo,
    infoGeometry,
    independentInfo: true,
    nestedEscape: true,
    closeReturnsFocus: true,
  };
}

export async function checkWallpaperMotion(page, frame) {
  await frame.locator("html").evaluate(() => {
    const original = document.querySelector("#results .result");
    window.__wallpaperEntranceProbe = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(Error("No replacement wallpaper cards appeared"));
      }, 60000);
      const observer = new MutationObserver(() => {
        const card = document.querySelector("#results .result");
        if (!card || card === original) return;
        observer.disconnect();
        clearTimeout(timer);
        const start = performance.now();
        const samples = [];
        const sample = () => {
          const style = getComputedStyle(card);
          const matrix = new DOMMatrixReadOnly(style.transform);
          samples.push({ y: matrix.m42, opacity: Number(style.opacity) });
          if (performance.now() - start < 750) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      });
      observer.observe(document.querySelector("#results"), { childList: true });
    });
  });
  await frame.locator("#provider").selectOption("wallhaven");
  const entrance = await frame
    .locator("html")
    .evaluate(() => window.__wallpaperEntranceProbe);
  expect(Math.max(...entrance.map((sample) => sample.y))).toBeGreaterThan(5);
  expect(Math.min(...entrance.map((sample) => sample.opacity))).toBeLessThan(
    0.5,
  );
  expect(entrance.at(-1).opacity).toBeCloseTo(1, 2);
  expect(entrance.at(-1).y).toBeCloseTo(0, 1);
  const first = frame.locator("#results .result").first();
  await expect(first.locator("img")).toBeVisible({ timeout: 60000 });
  const transform = () =>
    first.evaluate((node) => {
      const card = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      const image = new DOMMatrixReadOnly(
        getComputedStyle(node.querySelector("img")).transform,
      );
      return { lift: card.m42, imageScale: image.m11 };
    });
  await first.hover();
  await expect.poll(async () => (await transform()).lift).toBeLessThan(-2.9);
  await expect
    .poll(async () => (await transform()).imageScale)
    .toBeGreaterThan(1.04);
  const hover = await transform();
  await page.evaluate(() =>
    window.__extensionSettingsTest.update({ motion: "reduced" }),
  );
  await expect(frame.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect.poll(transform).toEqual({ lift: 0, imageScale: 1 });
  await page.evaluate(() =>
    window.__extensionSettingsTest.update({ motion: "full" }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(transform).toEqual({ lift: 0, imageScale: 1 });
  return {
    entrance,
    hover,
    hostReducedMotionStopsTransforms: true,
    systemReducedMotionStopsTransforms: true,
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

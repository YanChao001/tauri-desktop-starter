import { expect } from "@playwright/test";

export async function checkWindowSkin(
  page,
  frame,
  inheritsSkin,
  screenshot,
  transparentLayouts = [],
) {
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
    if (inheritsSkin || transparentLayouts.length)
      for (const selector of ["html", "body"])
        await expect(frame.locator(selector)).toHaveCSS(
          "background-color",
          "rgba(0, 0, 0, 0)",
        );
    if (transparentLayouts.length) {
      for (const intensity of [0, 50, 100]) {
        await page.evaluate(
          (backgroundIntensity) =>
            window.__extensionSettingsTest.update({ backgroundIntensity }),
          intensity,
        );
        await expect(page.locator("html")).toHaveAttribute(
          "data-background-intensity",
          String(intensity),
        );
        const surface = await page
          .locator("html")
          .evaluate((node) =>
            getComputedStyle(node).getPropertyValue("--surface-card").trim(),
          );
        await expect
          .poll(() =>
            frame
              .locator("html")
              .evaluate((node) =>
                getComputedStyle(node)
                  .getPropertyValue("--surface-card")
                  .trim(),
              ),
          )
          .toBe(surface);
        for (const selector of transparentLayouts)
          for (const node of await frame.locator(selector).all())
            await expect(node).toHaveCSS(
              "background-color",
              "rgba(0, 0, 0, 0)",
            );
      }
      await page.evaluate(() =>
        window.__extensionSettingsTest.update({ backgroundIntensity: 50 }),
      );
    }
    // 阅读材质由工作台外框承担，内部侧栏/页脚继承它，避免重复叠加底色。
    const surfaceSelector = ".studio-console,button.result,.card";
    const inheritedPanels = frame.locator(
      ".studio-console :is(.inspector,.side-panel,.scene-footer,.flow-results)",
    );
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
    const configuredAlpha = (intensity) =>
      page.locator("html").evaluate((node, intensity) => {
        if (intensity === 0) return 255;
        const property =
          intensity === 50
            ? "--ui-panel-opacity-at-half"
            : "--ui-panel-opacity-at-full";
        return (
          (255 *
            parseFloat(getComputedStyle(node).getPropertyValue(property))) /
          100
        );
      }, intensity);
    if (inheritsSkin) {
      // 壁纸首批卡片由实际 Wasm 异步返回，文档 ready 不代表结果节点已挂载。
      await expect
        .poll(() => frame.locator(surfaceSelector).count(), { timeout: 60000 })
        .toBeGreaterThan(0);
      for (const intensity of [0, 50, 100]) {
        await page.evaluate(
          (backgroundIntensity) =>
            window.__extensionSettingsTest.update({ backgroundIntensity }),
          intensity,
        );
        const alpha = await configuredAlpha(intensity);
        await expect
          .poll(async () =>
            (await surfaceAlpha()).every(
              (value) => Math.abs(value - alpha) <= 1,
            ),
          )
          .toBe(true);
        for (const panel of await inheritedPanels.all())
          await expect(panel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        expect(await backgrounds()).toEqual(before);
      }
      await page.evaluate(() =>
        window.__extensionSettingsTest.update({ backgroundIntensity: 50 }),
      );
      const halfAlpha = await configuredAlpha(50);
      await expect
        .poll(async () =>
          (await surfaceAlpha()).every(
            (value) => Math.abs(value - halfAlpha) <= 1,
          ),
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

// 使用真实宿主组件作为期望值，捕获插件作者 CSS 重新覆盖默认样式造成的漂移。
// 只比较视觉属性；宽度、排列、编辑区高度和内容专用绘制由各插件负责。
export async function checkHostControlStyles(
  page,
  frame,
  selectors,
  { styleProperties, compareHeight = true } = {},
) {
  await page.mouse.move(0, 0);
  const measurements = [];
  const properties = styleProperties ?? [
    "boxSizing",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "borderTopLeftRadius",
    "borderTopWidth",
    "borderTopStyle",
    "borderTopColor",
    "backgroundColor",
    "color",
    "backdropFilter",
  ];
  for (const selector of selectors) {
    const control = frame.locator(selector);
    await expect(control, `Required shared control ${selector}`).toBeVisible();
    const actual = await control.evaluate((node, properties) => {
      const classes = [...node.classList];
      const variant =
        node.dataset.variant ??
        classes
          .find((name) =>
            /^ui-button-(outline|secondary|ghost|destructive)$/.test(name),
          )
          ?.slice("ui-button-".length) ??
        "default";
      const size =
        classes
          .find((name) => name.startsWith("ui-button-size-"))
          ?.slice("ui-button-size-".length) ?? "default";
      const reference =
        node.tagName === "BUTTON"
          ? `button:${variant}:${size}`
          : node.tagName.toLowerCase();
      const styles = getComputedStyle(node);
      return {
        reference,
        height: node.getBoundingClientRect().height,
        styles: Object.fromEntries(
          properties.map((property) => [property, styles[property]]),
        ),
      };
    }, properties);
    const expected = await page
      .locator(`[data-host-style-reference="${actual.reference}"]`)
      .evaluate((node, properties) => {
        const styles = getComputedStyle(node);
        return {
          height: node.getBoundingClientRect().height,
          styles: Object.fromEntries(
            properties.map((property) => [property, styles[property]]),
          ),
        };
      }, properties);
    // Chromium 对原生单选框保留 normal；HTML 弹层行高由独立下拉检查验证。
    if (
      actual.reference === "select" &&
      actual.styles.lineHeight === "normal"
    ) {
      delete actual.styles.lineHeight;
      delete expected.styles.lineHeight;
    }
    expect(actual.styles, `Host style inheritance of ${selector}`).toEqual(
      expected.styles,
    );
    if (compareHeight && actual.reference !== "textarea")
      expect(actual.height, `Host control height of ${selector}`).toBeCloseTo(
        expected.height,
        0,
      );
    measurements.push({ selector, ...actual });
  }
  return measurements;
}

export async function checkNormalControls(page, frame, name, fontSize) {
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
    "lan-chat": "#settings-toggle,#emoji-toggle,#send-image,#send-file,#send",
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
  const ordinary = {
    "scientific-calculator": [], // 数学键盘/导航是明确专用设计；转换器另验普通下拉。
    "lan-chat": ["#settings-toggle", "#send-image", "#send-file", "#send"],
    "wallpaper-browser": ["#refresh", "#import", "#settings"],
    lab: ["#canvas-add", "#canvas-arrange", "#node-title", "#node-target"],
  };
  const styleParity = await checkHostControlStyles(page, frame, ordinary[name]);
  return { controls, styleParity };
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
          manage: "权限",
          moreActions: `${manifest.name}的操作`,
          group: "可选权限",
          all: "全选",
          cancel: "取消",
        }
      : {
          manage: "Permissions",
          moreActions: `Actions for ${manifest.name}`,
          group: "Optional permissions",
          all: "Select all",
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
  const alignment = await group.locator("li").evaluateAll((nodes) =>
    nodes.map((node) => {
      const checkbox = node.querySelector('[role="checkbox"]');
      const text = node.querySelector("label");
      const description = document.getElementById(
        checkbox.getAttribute("aria-describedby"),
      );
      const box = checkbox.getBoundingClientRect();
      const span = text.getBoundingClientRect();
      const detail = description.getBoundingClientRect();
      const row = node.getBoundingClientRect();
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
        textWithinRow: span.left >= row.left && span.right <= row.right + 1,
        descriptionWithinRow:
          detail.left >= span.left - 1 && detail.right <= row.right + 1,
        overflow: Math.max(0, node.scrollWidth - node.clientWidth),
      };
    }),
  );
  for (const row of alignment) {
    expect(row.alignmentError).toBeLessThanOrEqual(1);
    expect(row.gap).toBeGreaterThan(0);
    expect(row.textWithinRow).toBe(true);
    expect(row.descriptionWithinRow).toBe(true);
    expect(row.overflow).toBeLessThanOrEqual(1);
  }
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
        "next-batch",
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

export async function checkWallpaperLocalSurfaces(page, frame, capturePrefix) {
  const remote = frame.locator("#remote-tab");
  const local = frame.locator("#local-tab");
  await local.click();
  const card = frame.locator("#gallery [data-wallpaper-id]").first();
  await expect(card.locator("h2")).toHaveText("Fixture local image");
  const settingsProbe = page.locator("[data-wallpaper-settings-probe]");
  const settingsCard = settingsProbe.locator(".wallpaper-card").first();
  await expect(settingsCard).toHaveCount(1);
  const rootSize = await frame
    .locator("html")
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  const tabs = await frame.locator('.tabs [role="tab"]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        id: node.id,
        height: node.getBoundingClientRect().height,
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
      };
    }),
  );
  for (const tab of tabs) {
    expect(tab.height).toBeCloseTo(rootSize * 2, 1);
    expect(tab.fontSize).toBeCloseTo(rootSize * 0.875, 1);
    expect(tab.lineHeight).toBeCloseTo(rootSize * 1.25, 1);
  }
  for (const [key, target] of [
    ["ArrowLeft", remote],
    ["ArrowRight", local],
    ["Home", remote],
    ["End", local],
  ]) {
    await frame.locator('.tabs [aria-selected="true"]').focus();
    await frame.locator('.tabs [aria-selected="true"]').press(key);
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute("aria-selected", "true");
  }
  const sample = (locator, captionSelector) =>
    locator.evaluate((node, captionSelector) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const read = (element) => {
        const style = getComputedStyle(element);
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return {
          element: element.tagName.toLowerCase(),
          class: element.className,
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          rgba: [...context.getImageData(0, 0, 1, 1).data],
          opacity: style.opacity,
          backdropFilter: style.backdropFilter,
          surfaceCard: style.getPropertyValue("--surface-card").trim(),
          skinCardOpacity: style.getPropertyValue("--skin-card-opacity").trim(),
        };
      };
      const ancestors = [];
      for (
        let parent = node.parentElement;
        parent;
        parent = parent.parentElement
      )
        ancestors.push(read(parent));
      return {
        card: read(node),
        caption: read(node.querySelector(captionSelector)),
        ancestors,
      };
    }, captionSelector);
  const previous = await page.evaluate(() =>
    window.__extensionSettingsTest.read(),
  );
  const samples = [];
  try {
    for (const theme of ["light", "dark"])
      for (const backgroundIntensity of [0, 50, 100]) {
        await page.evaluate(
          (patch) => window.__extensionSettingsTest.update(patch),
          {
            theme,
            background: "aurora",
            backgroundIntensity,
          },
        );
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        await expect(frame.locator("html")).toHaveClass(new RegExp(theme));
        const configuredAlpha = await page
          .locator("html")
          .evaluate((node, intensity) => {
            if (intensity === 0) return 255;
            const property =
              intensity === 50
                ? "--ui-panel-opacity-at-half"
                : "--ui-panel-opacity-at-full";
            return (
              (255 *
                parseFloat(getComputedStyle(node).getPropertyValue(property))) /
              100
            );
          }, backgroundIntensity);
        await expect
          .poll(async () => {
            const host = await sample(settingsCard, ":scope > div:last-child");
            const plugin = await sample(card, ".card-heading");
            return (
              JSON.stringify(plugin.card.rgba) ===
                JSON.stringify(host.card.rgba) &&
              plugin.card.surfaceCard === host.card.surfaceCard &&
              plugin.card.skinCardOpacity === host.card.skinCardOpacity &&
              Math.abs(plugin.card.rgba[3] - configuredAlpha) <= 1
            );
          })
          .toBe(true);
        const host = await sample(settingsCard, ":scope > div:last-child");
        const plugin = await sample(card, ".card-heading");
        expect(host.caption.rgba[3]).toBe(0);
        expect(plugin.caption.rgba[3]).toBe(0);
        expect(plugin.caption.backgroundImage).toBe("none");
        const screenshot = `${capturePrefix}-${theme}-${backgroundIntensity}.png`;
        await page.screenshot({ path: screenshot });
        samples.push({ theme, backgroundIntensity, host, plugin, screenshot });
      }
  } finally {
    await page.evaluate(
      (settings) => window.__extensionSettingsTest.update(settings),
      previous,
    );
  }
  return { tabs, tabKeyboardNavigation: true, samples, nativeIpc: false };
}

export async function waitWallpaperVisibleThumbnails(frame) {
  await expect
    .poll(
      () =>
        frame.locator("#results .result").evaluateAll((cards) => {
          const visible = cards.filter((card) => {
            const box = card.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              box.bottom > 0 &&
              box.top < innerHeight &&
              box.right > 0 &&
              box.left < innerWidth
            );
          });
          return (
            visible.length > 0 &&
            visible.every((card) => {
              const image = card.querySelector("img");
              return image?.complete && image.naturalWidth > 0;
            })
          );
        }),
      { timeout: 60000 },
    )
    .toBe(true);
}

async function wallpaperCapacity(page, frame) {
  const sdk = await frame.locator("html").evaluate(() => ({
    peak: window.__sdkPendingPeak ?? 0,
    rejections: window.__sdkCapacityRejections ?? 0,
  }));
  expect(sdk.peak).toBeLessThanOrEqual(4);
  expect(sdk.rejections).toBe(0);
  expect(
    await page.evaluate(() =>
      window.__protocolErrors.filter(
        (receipt) => receipt.error?.code === "EXTENSION_BUSY",
      ),
    ),
  ).toEqual([]);
  return sdk;
}

export async function checkWallpaperStartupCapacity({ page, frame }) {
  try {
    await expect(frame.locator("#results .result")).toHaveCount(24, {
      timeout: 60000,
    });
    await expect
      .poll(
        () => page.evaluate(() => window.__fixtureStartupReplies.held.length),
        { timeout: 60000 },
      )
      .toBeGreaterThanOrEqual(3);
    const methods = await frame
      .locator("html")
      .evaluate(() => window.__iframeProtocolRequests);
    expect(methods.some((call) => call.method === "run")).toBe(true);
    expect(methods.some((call) => call.method === "checkpoint")).toBe(true);
    expect(
      methods.some(
        (call) => call.service === "wallpaper" && call.action === "list",
      ),
    ).toBe(true);
    return {
      startupListCheckpointRunRemainPending: true,
      resultStateDoesNotOverflowSdk: true,
      sdk: await wallpaperCapacity(page, frame),
    };
  } finally {
    await page.evaluate(() => window.__fixtureStartupReplies.release());
  }
}

export async function checkWallpaperMetadataLoading({
  page,
  frame,
  services,
  gates,
  capturePath,
}) {
  const decoded = () =>
    frame
      .locator("#gallery img")
      .evaluateAll(
        (images) =>
          images.filter((image) => image.complete && image.naturalWidth > 0)
            .length,
      );
  try {
    await frame.locator("#local-tab").click();
    await expect(frame.locator("#gallery [data-wallpaper-id]")).toHaveCount(3);
    await expect(frame.locator("#gallery h2")).toHaveText([
      "Fixture local image",
      "Fixture local image 2",
      "Fixture local image 3",
    ]);
    await expect.poll(gates[0].started).toBe(true);
    expect(await decoded()).toBe(0);
    await expect(frame.locator("#import")).toBeEnabled();
    await expect(
      frame.locator('#gallery [data-action="apply"]').first(),
    ).toBeEnabled();
    await frame.locator('#gallery [data-action="apply"]').first().click();
    await expect(
      frame.locator("#gallery [data-wallpaper-id]").first(),
    ).toHaveClass(/active/);
    expect(gates[0].released()).toBe(false);
    for (let index = 0; index < gates.length; index++) {
      expect(gates[index].released()).toBe(false);
      gates[index].release();
      await expect.poll(decoded).toBe(index + 1);
      if (index + 1 < gates.length) {
        await expect.poll(gates[index + 1].started).toBe(true);
        expect(gates[index + 1].released()).toBe(false);
      }
      if (index === 1 && capturePath)
        await page.screenshot({ path: capturePath });
    }
    expect(services.imageConcurrency().localPreviewPeak).toBe(1);
    return {
      metadataCardsPrecedePreviews: true,
      metadataCardCanApplyBeforePreviewCompletes: true,
      previewsPaintIndependently: true,
      nativeGalleryPreviewConcurrency: 1,
      sdk: await wallpaperCapacity(page, frame),
    };
  } finally {
    for (const gate of gates) gate.release();
  }
}

export async function checkWallpaperRemoteLoading({
  page,
  frame,
  services,
  backgrounds,
  large,
  release,
  idle,
  capturePath,
}) {
  const decoded = () =>
    frame
      .locator("#results .result img")
      .evaluateAll(
        (images) =>
          images.filter((image) => image.complete && image.naturalWidth > 0)
            .length,
      );
  const runCalls = () =>
    frame
      .locator("html")
      .evaluate(
        () =>
          window.__iframeProtocolRequests.filter(
            (call) => call.method === "run",
          ).length,
      );
  const frameBarrier = () =>
    frame
      .locator("html")
      .evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
  try {
    await expect(frame.locator("#results .result")).toHaveCount(24, {
      timeout: 60000,
    });
    for (const gate of backgrounds)
      await expect.poll(gate.started, { timeout: 60000 }).toBe(true);
    expect(await decoded()).toBe(0);
    const firstIds = await frame
      .locator("#results .result")
      .evaluateAll((cards) => cards.map((card) => card.dataset.resultId));
    const initialRuns = await runCalls();
    await frame.locator("#results .result").first().click();
    await expect.poll(large.started, { timeout: 10000 }).toBe(true);
    for (const gate of backgrounds) {
      expect(gate.released()).toBe(false);
      expect(gate.cancelled()).toBe(false);
    }
    large.release();
    await expect
      .poll(() =>
        frame.locator("#preview-image").evaluate((image) => image.naturalWidth),
      )
      .toBe(1920);
    expect(
      await frame
        .locator("html")
        .evaluate(() =>
          window.__iframeProtocolRequests.some(
            (call) => call.service === "resources" && call.action === "preview",
          ),
        ),
    ).toBe(false);
    for (const gate of backgrounds) expect(gate.released()).toBe(false);
    expect(release.released()).toBe(false);
    for (const gate of backgrounds) gate.release();
    await expect.poll(release.started).toBe(true);
    await expect(frame.locator("#preview-image")).toBeVisible();
    expect(
      await frame
        .locator("#preview-image")
        .evaluate((image) => image.naturalWidth),
    ).toBe(1920);
    if (capturePath) await page.screenshot({ path: capturePath });
    release.release();
    await frame.locator("#preview-close").click();
    await waitWallpaperVisibleThumbnails(frame);
    await idle(page, frame);
    expect(await runCalls()).toBe(initialRuns);
    await frame.locator("#load-more-sentinel").scrollIntoViewIfNeeded();
    await expect(frame.locator("#results .result")).toHaveCount(48, {
      timeout: 60000,
    });
    await idle(page, frame);
    const appended = await frame
      .locator("#results .result")
      .evaluateAll((cards) => cards.map((card) => card.dataset.resultId));
    expect(appended.slice(0, 24)).toEqual(firstIds);
    expect(new Set(appended).size).toBe(48);
    await frameBarrier();
    expect(await runCalls()).toBe(initialRuns + 1);
    await frame.locator("#query").fill("landscape");
    await frame.locator("#search").click();
    await idle(page, frame);
    await expect(frame.locator("#results .result")).toHaveCount(24);
    const reset = await frame
      .locator("#results .result")
      .evaluateAll((cards) => cards.map((card) => card.dataset.resultId));
    expect(reset.some((id) => firstIds.includes(id))).toBe(false);
    await frameBarrier();
    expect(await runCalls()).toBe(initialRuns + 2);
    expect(services.imageConcurrency().downloadPeak).toBe(3);
    expect(services.imageConcurrency().ownerResourcePeak).toBeLessThanOrEqual(
      8,
    );
    return {
      selectedPreviewStartsBesideTwoHeldBackgrounds: true,
      inlineLargePreviewPaintsBeforeBackgroundsAndRelease: true,
      noExtraPreviewRoundTrip: true,
      downloadPeak: 3,
      ownerResourcePeak: services.imageConcurrency().ownerResourcePeak,
      scrollAppendsOnePageWithoutDuplicates: true,
      queryResetsAppendedCollection: true,
      noUnboundedAutomaticPagination: true,
      sdk: await wallpaperCapacity(page, frame),
    };
  } finally {
    for (const gate of backgrounds) gate.release();
    large.release();
    release.release();
  }
}

export async function checkWallpaperLocalConcurrency({
  page,
  frame,
  services,
  remote,
  initialList,
  capturePath,
}) {
  let backgroundList;
  const hostBusy = () =>
    frame.locator("html").evaluate(() => window.__sdkSnapshot?.busy);
  const listCalls = () =>
    services.calls.filter(
      (call) => call.service === "wallpaper" && call.request.action === "list",
    ).length;
  const serviceRequests = () =>
    frame
      .locator("html")
      .evaluate(() =>
        window.__iframeProtocolRequests
          .filter((call) => call.method === "service")
          .map((call) => ({ service: call.service, action: call.action })),
      );
  try {
    await expect.poll(remote.started, { timeout: 60000 }).toBe(true);
    await expect.poll(initialList.started, { timeout: 60000 }).toBe(true);
    await expect.poll(hostBusy).toBe(true);
    const listsBeforeSwitch = listCalls();
    await expect(frame.locator("#local-tab")).toBeEnabled();
    await frame.locator("#local-tab").click({ timeout: 1500 });
    await expect(frame.locator("#local-panel")).toBeVisible();
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(frame.locator("#import")).toBeEnabled();
    await expect(frame.locator("#settings")).toBeEnabled();
    expect(listCalls()).toBe(listsBeforeSwitch);
    expect(remote.released()).toBe(false);

    initialList.release();
    const card = frame.locator("#gallery [data-wallpaper-id]").first();
    await expect(card.locator("h2")).toHaveText("Fixture local image");
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    for (const action of ["apply", "rename", "remove"])
      await expect(card.locator(`[data-action="${action}"]`)).toBeEnabled();
    const cachedThumbnail = await card.locator("img").getAttribute("src"),
      beforeApply = (await serviceRequests()).length;
    await card.locator('[data-action="apply"]').click({ timeout: 1500 });
    await expect(card).toHaveClass(/active/);
    await expect(card.locator('[data-action="apply"]')).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(card.locator('[data-action="apply"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(card.locator("h2")).toHaveText("Fixture local image");
    await expect(card.locator("img")).toHaveAttribute("src", cachedThumbnail);
    await expect(frame.locator("#local-summary")).toContainText(
      "1 / 24 images",
    );
    expect((await serviceRequests()).slice(beforeApply)).toEqual([
      { service: "wallpaper", action: "apply" },
    ]);
    await expect.poll(hostBusy).toBe(true);
    expect(remote.released()).toBe(false);

    backgroundList = services.holdNextWallpaperList();
    await frame.locator("#refresh").click();
    await expect.poll(backgroundList.started).toBe(true);
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(card.locator("h2")).toHaveText("Fixture local image");
    await expect(frame.locator("#refresh")).toBeDisabled();
    await expect(frame.locator("#import")).toBeEnabled();
    await expect(frame.locator("#settings")).toBeEnabled();
    await expect(card.locator('[data-action="apply"]')).toBeEnabled();
    await expect(card.locator('[data-action="remove"]')).toBeEnabled();
    await card.locator('[data-action="rename"]').click({ timeout: 1500 });
    await frame.locator("#rename-value").fill("Newer local gallery write");
    await frame.locator("#dialog-confirm").click();
    await expect(card.locator("h2")).toHaveText("Newer local gallery write");
    expect(backgroundList.released()).toBe(false);
    expect(remote.released()).toBe(false);
    await expect.poll(hostBusy).toBe(true);
    if (capturePath) await page.screenshot({ path: capturePath });

    backgroundList.release();
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(card.locator("h2")).toHaveText("Newer local gallery write");
    await expect(card).toHaveClass(/active/);
    await expect(frame.locator("#refresh")).toBeEnabled();
    await expect.poll(hostBusy).toBe(true);
    expect(remote.released()).toBe(false);
    return {
      initialSourceAndGalleryReadsParallel: true,
      pendingListReadsDeduplicated: true,
      localSwitchWhileRemoteHostBusy: true,
      localApplyBeforeRemoteCompletes: true,
      compactApplyNeedsNoGalleryReadOrImageFetch: true,
      cachedThumbnailNameAndLimitSurviveApply: true,
      cachedGalleryUsableDuringBackgroundRead: true,
      staleReadCannotReplaceNewerWrite: true,
      nativeIpc: false,
    };
  } finally {
    initialList.release();
    backgroundList?.release();
    remote.release();
  }
}

export async function checkWallpaperApplyConcurrency({
  page,
  frame,
  services,
  idle,
  capturePath,
}) {
  const galleryReadCount = () =>
    frame
      .locator("html")
      .evaluate(
        () =>
          window.__iframeProtocolRequests.filter(
            (call) =>
              call.method === "service" &&
              call.service === "wallpaper" &&
              call.action === "list",
          ).length,
      );
  const notificationCount = () =>
    frame
      .locator("html")
      .evaluate(
        () =>
          window.__iframeProtocolRequests.filter(
            (call) => call.method === "notify",
          ).length,
      );
  await frame.locator("#local-tab").click();
  const card = frame.locator("#gallery [data-wallpaper-id]").first(),
    apply = card.locator('[data-action="apply"]'),
    success = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "App background updated." });
  await expect(card.locator("h2")).toHaveText("Fixture local image");
  await expect(frame.locator("#refresh")).toBeEnabled();
  await expect(apply).toHaveAttribute("aria-pressed", "false");
  const initialRevision = await page.evaluate(
    () =>
      window.__extensionUiTest.serviceCalls
        .filter(
          (call) =>
            call.service === "wallpaper" &&
            call.request.action === "list" &&
            call.completed,
        )
        .at(-1).response.revision,
  );
  const cachedThumbnail = await card.locator("img").getAttribute("src"),
    cachedId = await card.getAttribute("data-wallpaper-id");
  let failingList;
  const held = services.holdNextWallpaperApply(),
    applyCallsBefore = services.calls.filter(
      (call) => call.service === "wallpaper" && call.request.action === "apply",
    ).length;
  try {
    await apply.click();
    await expect.poll(held.started).toBe(true);
    await expect(apply).toHaveAttribute("aria-busy", "true");
    await expect(apply).toContainText("Applying…");
    await expect(frame.locator("#local-summary")).toContainText(
      "Applying background…",
    );
    for (const action of ["apply", "rename", "remove"])
      await expect(card.locator(`[data-action="${action}"]`)).toBeDisabled();
    await expect(frame.locator("#import")).toBeDisabled();
    await apply.evaluate((node) => node.click());
    expect(
      services.calls.filter(
        (call) =>
          call.service === "wallpaper" && call.request.action === "apply",
      ),
    ).toHaveLength(applyCallsBefore + 1);
    await expect(success).toHaveCount(0);
    await expect
      .poll(() =>
        frame.locator("html").evaluate(() => window.__sdkSnapshot?.busy),
      )
      .toBe(false);
    for (const id of ["remote-tab", "local-tab", "refresh", "settings", "fit"])
      await expect(frame.locator(`#${id}`)).toBeEnabled();

    const settingsBefore = services.calls.filter(
      (call) =>
        call.service === "wallpaper" && call.request.action === "open-settings",
    ).length;
    await frame.locator("#settings").click();
    await expect
      .poll(
        () =>
          services.calls.filter(
            (call) =>
              call.service === "wallpaper" &&
              call.request.action === "open-settings",
          ).length,
      )
      .toBe(settingsBefore + 1);
    await frame.locator("#refresh").click();
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(apply).toHaveAttribute("aria-pressed", "true");
    await expect(apply).toHaveAttribute("aria-busy", "true");
    await expect(success).toHaveCount(0);

    await frame.locator("#remote-tab").click({ timeout: 1500 });
    await expect(frame.locator("#remote-panel")).toBeVisible();
    for (const id of ["provider", "category", "query", "search"])
      await expect(frame.locator(`#${id}`)).toBeEnabled();
    const beforeHttp = services.httpCalls.length;
    const load = async (action, expectedCount) => {
      await action();
      await expect
        .poll(() => services.httpCalls.length, { timeout: 60000 })
        .toBe(expectedCount);
      await idle(page, frame);
      await expect(frame.locator("#results .result")).toHaveCount(24);
      expect(held.released()).toBe(false);
      await expect(success).toHaveCount(0);
    };
    await load(
      () => frame.locator("#provider").selectOption("wallcoo"),
      beforeHttp + 1,
    );
    await load(
      () => frame.locator("#category").selectOption("landscape"),
      beforeHttp + 2,
    );
    await frame.locator("#query").fill("parallel wallpaper apply");
    await load(() => frame.locator("#search").click(), beforeHttp + 3);
    const query = new URL(services.httpCalls.at(-1).request.url);
    expect(query.origin).toBe("https://www.wallcoo.com");
    expect(query.searchParams.get("search")).toBe("parallel wallpaper apply");
    await frame.locator("#local-tab").click();
    await expect(frame.locator("#refresh")).toBeEnabled();
    await expect(apply).toHaveAttribute("aria-busy", "true");
    await expect(frame.locator("#import")).toBeDisabled();
    expect(held.released()).toBe(false);
    failingList = services.holdNextWallpaperList({ fail: true });
    await frame.locator("#refresh").click();
    await expect.poll(failingList.started).toBe(true);
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    const galleryReadsBeforeAck = await galleryReadCount();
    if (capturePath) await page.screenshot({ path: capturePath });

    held.release();
    await expect(apply).toHaveAttribute("aria-busy", "false");
    await expect(apply).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveClass(/active/);
    for (const action of ["apply", "rename", "remove"])
      await expect(card.locator(`[data-action="${action}"]`)).toBeEnabled();
    await expect(frame.locator("#import")).toBeEnabled();
    await expect(success).toBeVisible();
    expect(failingList.released()).toBe(false);
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(card).toHaveAttribute("data-wallpaper-id", cachedId);
    await expect(card.locator("h2")).toHaveText("Fixture local image");
    await expect(card.locator("img")).toHaveAttribute("src", cachedThumbnail);
    await expect(frame.locator("#local-summary")).toContainText(
      "1 / 24 images",
    );
    expect(await galleryReadCount()).toBe(galleryReadsBeforeAck);
    const reply = await page.evaluate(
      () =>
        window.__extensionUiTest.serviceCalls.find(
          (call) =>
            call.service === "wallpaper" && call.request.action === "apply",
        ).response,
    );
    expect(reply).toEqual({
      applied: true,
      activeId: cachedId,
      revision: initialRevision + 1,
    });
    const notificationsBeforeFailure = await notificationCount();
    failingList.release();
    await expect(frame.locator("#gallery")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(card).toHaveClass(/active/);
    await expect(card.locator("img")).toHaveAttribute("src", cachedThumbnail);
    expect(await notificationCount()).toBe(notificationsBeforeFailure);
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]'),
    ).toHaveCount(0);
    return {
      applyBoundaryCommitsBeforeReply: true,
      applyingStatusVisibleUntilReply: true,
      libraryWritesSerialized: true,
      navigationRefreshSettingsRemainUsable: true,
      sourceCategoryAndRealWasmSearchCompleteBeforeApplyReply: true,
      noSuccessNotificationBeforeApplyReply: true,
      activeRevisionAndControlsRecover: true,
      applyAcknowledgementHasNoGalleryPayload: true,
      applyCompletesBeforeFailingGalleryRead: true,
      olderGalleryReadFailureCannotUndoApplySuccess: true,
      cachedIdentityThumbnailNameAndLimitSurviveApply: true,
      nativeIpc: false,
    };
  } finally {
    held.release();
    failingList?.release();
  }
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
          url: "https://www.bizhihui.com/fixture-1.jpg",
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
          url: "https://www.bizhihui.com/",
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
    if (mode === "direct") await waitWallpaperVisibleThumbnails(frame);
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
  await waitWallpaperVisibleThumbnails(frame);
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
  const thumbnailSize = await card.locator("img").evaluate((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  const selectedImage = await frame
    .locator("html")
    .evaluate(() => JSON.parse(window.__sdkSnapshot.view.state).items[1]);
  expect(selectedImage.displayUrl).not.toBe(selectedImage.previewUrl);
  const servicesBeforePreview = await page.evaluate(
    () => window.__extensionUiTest.serviceCalls.length,
  );
  const waitForFullPreview = async () => {
    await expect
      .poll(
        () =>
          frame
            .locator("#preview-image")
            .evaluate((image) => image.naturalWidth),
        { timeout: 60000 },
      )
      .toBeGreaterThan(thumbnailSize.width);
    const size = await frame.locator("#preview-image").evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    expect(size.height).toBeGreaterThan(thumbnailSize.height);
    return size;
  };
  await card.focus();
  await card.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(frame.locator("#preview-image")).toBeVisible();
  const previewSize = await waitForFullPreview();
  const { largePreviewRequested, displayImageRequested } = await page.evaluate(
    ({ offset, displayUrl }) => {
      const requests = window.__extensionUiTest.serviceCalls.slice(offset);
      return {
        largePreviewRequested: requests.some(
          (call) =>
            call.service === "resources" &&
            call.request.action === "fetch-image" &&
            call.request.preview === "large" &&
            typeof call.response?.dataUrl === "string" &&
            call.completed,
        ),
        displayImageRequested: requests.some(
          (call) =>
            call.service === "resources" &&
            call.request.action === "fetch-image" &&
            call.request.url === displayUrl &&
            call.completed,
        ),
      };
    },
    { offset: servicesBeforePreview, displayUrl: selectedImage.displayUrl },
  );
  expect(largePreviewRequested).toBe(true);
  expect(displayImageRequested).toBe(true);
  const initialTitle = await frame.locator("#preview-title").textContent();
  await expect(frame.locator("#preview-previous")).toBeEnabled();
  await expect(frame.locator("#preview-next")).toBeEnabled();
  await frame.locator("#preview-close").press("ArrowRight");
  await expect(frame.locator("#preview-title")).not.toHaveText(initialTitle);
  await waitForFullPreview();
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await frame.locator("#preview-close").press("ArrowLeft");
  await expect(frame.locator("#preview-title")).toHaveText(initialTitle);
  await waitForFullPreview();
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
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
      ? ["Add to gallery", "Save HD image", "Source"]
      : ["加入图库", "保存高清图", "来源"];
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
    thumbnailSize,
    previewSize,
    largePreviewRequested,
    displayImageRequested,
    keyboardPreviewNavigation: true,
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
  await frame.locator("#provider").selectOption("wallcoo");
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
  await expect.poll(transform).toEqual({ lift: 0, imageScale: 1 });
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
    stableImageOnHover: true,
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

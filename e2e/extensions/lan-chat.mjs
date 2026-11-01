import { expect } from "@playwright/test";

function expectStableRect(before, after, diagnostics) {
  for (const key of ["x", "y", "width", "height"])
    expect(
      Math.abs(after[key] - before[key]),
      key + (diagnostics ? "\n" + JSON.stringify(diagnostics) : ""),
    ).toBeLessThanOrEqual(1);
}
async function settingsGeometry(frame, phase) {
  return frame.locator("#settings-panel").evaluate((node, phase) => {
    const bounds = (element) => {
      const { x, y, width, height, bottom, right } =
        element.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    const scroll = document.scrollingElement;
    const settingsScroll = document.getElementById("settings-scroll");
    const style = getComputedStyle(node);
    const sample = {
      phase,
      panel: bounds(node),
      app: bounds(document.querySelector(".app")),
      body: bounds(document.body),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollX,
        scrollY,
        visualHeight: visualViewport?.height,
        visualTop: visualViewport?.offsetTop,
      },
      document: {
        top: scroll?.scrollTop,
        height: scroll?.scrollHeight,
        visible: scroll?.clientHeight,
        bodyTop: document.body.scrollTop,
      },
      settingsScroll: {
        top: settingsScroll.scrollTop,
        height: settingsScroll.scrollHeight,
        visible: settingsScroll.clientHeight,
      },
      computed: {
        position: style.position,
        bottom: style.bottom,
        height: style.height,
        maxHeight: style.maxHeight,
        transform: style.transform,
      },
      focus: {
        tag: document.activeElement?.tagName,
        id: document.activeElement?.id,
      },
    };
    (window.__lanSettingsGeometryTrace ??= []).push(sample);
    return sample;
  }, phase);
}
async function resizeViewport(page, frame, viewport) {
  await page.setViewportSize(viewport);
  const painted = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  let previous;
  let stable = 0;
  let latest;
  await expect
    .poll(
      async () => {
        // 宿主的 ResizeObserver 在父文档排队调整 iframe；只等子文档 RAF 会读到旧 viewport。
        await page.evaluate(painted);
        const host = await page.locator("iframe").evaluate((node) => {
          const { x, y, width, height, bottom } = node.getBoundingClientRect();
          return {
            viewport: { width: innerWidth, height: innerHeight },
            frame: { x, y, width, height, bottom },
            client: { width: node.clientWidth, height: node.clientHeight },
          };
        });
        await frame.locator("html").evaluate(painted);
        const child = await frame
          .locator("html")
          .evaluate(() => ({ width: innerWidth, height: innerHeight }));
        latest = { host, child };
        const dimensions = [
          host.frame.x,
          host.frame.y,
          host.frame.width,
          host.frame.height,
          child.width,
          child.height,
        ];
        const synchronized =
          host.viewport.width === viewport.width &&
          host.viewport.height === viewport.height &&
          Math.abs(host.client.width - child.width) <= 1 &&
          Math.abs(host.client.height - child.height) <= 1 &&
          host.frame.bottom <= viewport.height + 1;
        const unchanged =
          previous &&
          dimensions.every(
            (value, index) => Math.abs(value - previous[index]) <= 1,
          );
        stable = synchronized && unchanged ? stable + 1 : 0;
        previous = dimensions;
        return stable >= 2;
      },
      {
        timeout: 15000,
        intervals: [0],
        message: "Host iframe and child viewport stabilize after resize",
      },
    )
    .toBe(true);
  return latest;
}
async function checkSettingsPanel(page, frame, capturePrefix) {
  const originalViewport = page.viewportSize();
  const expandedGeometry = await settingsGeometry(frame, "expanded");
  await page.screenshot({ path: capturePrefix + "-settings.png" });
  await resizeViewport(page, frame, { ...originalViewport, height: 450 });
  const initialGeometry = await settingsGeometry(frame, "after-short-resize");
  const before = initialGeometry.panel;
  const viewport = initialGeometry.viewport;
  expect(before.x).toBeGreaterThanOrEqual(0);
  expect(before.y).toBeGreaterThanOrEqual(0);
  expect(before.x + before.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(before.y + before.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.screenshot({ path: capturePrefix + "-settings-short.png" });
  const details = frame.locator("#connection-details");
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", true);
  const copy = await details.locator(".connection-copy").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return [...node.querySelectorAll("p")].map((paragraph) => {
      const rect = paragraph.getBoundingClientRect();
      return {
        left: rect.left - bounds.left,
        right: bounds.right - rect.right,
        width: rect.width,
        scrollWidth: paragraph.scrollWidth,
      };
    });
  });
  for (const paragraph of copy) {
    expect(paragraph.left).toBeGreaterThanOrEqual(12);
    expect(paragraph.right).toBeGreaterThanOrEqual(12);
    expect(paragraph.scrollWidth).toBeLessThanOrEqual(paragraph.width + 1);
  }
  await settingsGeometry(frame, "details-open");
  await frame.locator("#data-management > summary").click();
  await frame.locator("#clear").scrollIntoViewIfNeeded();
  const scroll = () =>
    frame.locator("#settings-scroll").evaluate((node) => ({
      top: node.scrollTop,
      height: node.scrollHeight,
      visible: node.clientHeight,
    }));
  const scrolled = await scroll();
  expect(scrolled.height).toBeGreaterThan(scrolled.visible + 1);
  expect(scrolled.top).toBeGreaterThan(0);
  const scrolledGeometry = await settingsGeometry(
    frame,
    "clear-scrolled-into-view",
  );
  expectStableRect(before, scrolledGeometry.panel, {
    before: initialGeometry,
    after: scrolledGeometry,
  });
  await expect(frame.locator("#lan-settings")).toBeVisible();
  await expect(frame.locator("#loopback-settings")).toBeVisible();
  await expect(frame.locator("#mode-lan,#mode-loopback")).toHaveCount(0);
  const after = await scroll();
  expect(Math.abs(after.top - scrolled.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - scrolled.height)).toBeLessThanOrEqual(1);
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", false);
  await frame.locator("#data-management > summary").click();
  await resizeViewport(page, frame, originalViewport);
  return {
    expandedRect: expandedGeometry.panel,
    rect: before,
    viewport,
    scroll: scrolled,
    lanAndLoopbackSharePanel: true,
  };
}
async function checkActionStability(page, frame) {
  await page.evaluate(() => {
    window.__extensionUiTest.serviceTiming.lanNicknameMs = 600;
  });
  await frame.locator("#settings-toggle").click();
  await frame.locator("#messages").evaluate((messages) => {
    const images = [...messages.querySelectorAll("img")];
    const controls = [
      ...document.querySelectorAll(
        ".composer-tools button,.preview-attachment,.contact",
      ),
    ];
    const appearances = controls.map((node) => ({
      disabled: node.disabled,
      opacity: getComputedStyle(node).opacity,
    }));
    const probe = (window.__lanActionStability = {
      samples: 0,
      missingImages: 0,
      missingControls: 0,
      changedControls: 0,
      raf: 0,
    });
    const sample = () => {
      probe.samples++;
      probe.missingImages += images.filter(
        (node) => !node.isConnected || !node.complete,
      ).length;
      controls.forEach((node, index) => {
        if (!node.isConnected) probe.missingControls++;
        else if (
          node.disabled !== appearances[index].disabled ||
          getComputedStyle(node).opacity !== appearances[index].opacity
        )
          probe.changedControls++;
      });
      probe.raf = requestAnimationFrame(sample);
    };
    sample();
  });
  let probe;
  try {
    await frame.locator("#rename").click();
    await expect(frame.locator("#rename")).toHaveAttribute("aria-busy", "true");
    await expect(frame.locator("#layout")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  } finally {
    probe = await frame.locator("html").evaluate(() => {
      const probe = window.__lanActionStability;
      cancelAnimationFrame(probe.raf);
      delete window.__lanActionStability;
      return probe;
    });
    await page.evaluate(() => {
      window.__extensionUiTest.serviceTiming.lanNicknameMs = 0;
    });
    await frame.locator("#close-settings").click();
  }
  expect(probe.samples).toBeGreaterThan(2);
  expect(probe.missingImages).toBe(0);
  expect(probe.missingControls).toBe(0);
  expect(probe.changedControls).toBe(0);
  return probe;
}
async function separatorState(separator) {
  const attributes = await separator.evaluate((node) => ({
    value: node.getAttribute("aria-valuenow"),
    minimum: node.getAttribute("aria-valuemin"),
    maximum: node.getAttribute("aria-valuemax"),
  }));
  for (const value of Object.values(attributes)) {
    expect(value).not.toBeNull();
    expect(value.trim()).not.toBe("");
  }
  const state = Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, Number(value)]),
  );
  expect(Number.isFinite(state.value)).toBe(true);
  expect(state.minimum).toBeLessThanOrEqual(state.maximum);
  expect(state.value).toBeGreaterThanOrEqual(state.minimum - 1);
  expect(state.value).toBeLessThanOrEqual(state.maximum + 1);
  return state;
}
async function dragSeparator(page, separator, dx, dy) {
  const bounds = await separator.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}
async function checkLayoutCustomization(page, frame, profile) {
  const originalViewport = page.viewportSize();
  const column = frame.locator("#conversation-resizer");
  const composer = frame.locator("#composer-resizer");
  await expect(frame.locator(".rail,#refresh,#my-avatar")).toHaveCount(0);
  await expect(frame.locator("#peer-avatar")).not.toBeVisible();
  const header = await frame.locator("#chat-header").evaluate((node) => {
    const bounds = (element) => {
      const { x, y, width, height, right, bottom } =
        element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    return {
      viewport: innerWidth,
      bar: bounds(node),
      name: bounds(document.getElementById("peer-name")),
      address: bounds(document.getElementById("peer-detail")),
      actions: bounds(document.getElementById("conversation-more")),
      minHeight: parseFloat(getComputedStyle(node).minHeight),
      addressAlign: getComputedStyle(document.getElementById("peer-detail"))
        .textAlign,
    };
  });
  expect(header.minHeight).toBe(header.viewport <= 600 ? 38 : 42);
  expect(header.addressAlign).toBe("center");
  expect(
    Math.abs(
      header.address.x +
        header.address.width / 2 -
        header.bar.x -
        header.bar.width / 2,
    ),
  ).toBeLessThanOrEqual(1);
  expect(header.name.right).toBeLessThanOrEqual(header.address.x + 1);
  expect(header.address.right).toBeLessThanOrEqual(header.actions.x + 1);
  for (const item of [header.name, header.address, header.actions]) {
    expect(item.y).toBeGreaterThanOrEqual(header.bar.y);
    expect(item.bottom).toBeLessThanOrEqual(header.bar.bottom + 1);
  }
  const listActions = await frame.locator(".list-actions").evaluate((node) => ({
    controls: [...node.querySelectorAll("button")].map((button) => ({
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
      svg: button.querySelectorAll("svg").length,
      glyphWidth:
        button.querySelector("svg")?.getBoundingClientRect().width ?? 0,
      glyphHeight:
        button.querySelector("svg")?.getBoundingClientRect().height ?? 0,
      text: button.textContent.trim(),
    })),
  }));
  for (const button of listActions.controls) {
    expect(button.width).toBeGreaterThanOrEqual(28);
    expect(button.width).toBeLessThanOrEqual(parseFloat(profile.font) * 2);
    expect(button.height).toBeGreaterThanOrEqual(28);
    expect(button.height).toBeLessThanOrEqual(parseFloat(profile.font) * 2);
    expect(button.svg).toBe(1);
    expect(button.glyphWidth).toBeGreaterThanOrEqual(16);
    expect(button.glyphHeight).toBeGreaterThanOrEqual(16);
    expect(button.glyphWidth).toBeLessThanOrEqual(button.width);
    expect(button.glyphHeight).toBeLessThanOrEqual(button.height);
    expect(button.text).toBe("");
  }
  const avatars = await frame.locator(".avatar").evaluateAll((nodes) =>
    nodes.map((node) => ({
      svg: node.querySelectorAll("svg.avatar-mark[data-icon]").length,
      initial: [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent)
        .join("")
        .trim(),
    })),
  );
  expect(avatars.length).toBeGreaterThan(3);
  for (const avatar of avatars) {
    expect(avatar.svg).toBe(1);
    expect(avatar.initial).toBe("");
  }
  const fontSizes = await frame
    .locator(
      "#draft,.bubble:not(.sticker),#peer-name,.contact-name strong,.file-name",
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getBoundingClientRect().height > 0)
        .map((node) => ({
          control: node.id || node.className,
          fontSize: parseFloat(getComputedStyle(node).fontSize),
        })),
    );
  for (const item of fontSizes)
    expect(item.fontSize, item.control).toBeGreaterThanOrEqual(
      parseFloat(profile.font) * 0.8 - 0.01,
    );
  if (!(await column.isVisible())) {
    await expect(column).toHaveAttribute("aria-disabled", "true");
    await expect(column).toHaveAttribute("tabindex", "-1");
    await resizeViewport(page, frame, { width: 1120, height: 800 });
  }
  await expect(column).toBeVisible();
  await expect(column).toHaveAttribute("role", "separator");
  await expect(column).toHaveAttribute("aria-orientation", "vertical");
  await expect(composer).toHaveAttribute("role", "separator");
  await expect(composer).toHaveAttribute("aria-orientation", "horizontal");
  const columnBefore = await separatorState(column);
  await dragSeparator(page, column, 44, 0);
  const columnDragged = await separatorState(column);
  expect(columnDragged.value).toBeGreaterThan(columnBefore.value + 10);
  const width = await frame
    .locator(".contacts")
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(width).toBeCloseTo(columnDragged.value, 0);
  await column.focus();
  await column.press("ArrowLeft");
  expect((await separatorState(column)).value).toBeLessThan(
    columnDragged.value,
  );
  await column.press("Home");
  await column.press("ArrowLeft");
  const columnMinimum = await separatorState(column);
  expect(columnMinimum.value).toBeCloseTo(columnMinimum.minimum, 0);
  await column.press("End");
  await column.press("ArrowRight");
  const columnMaximum = await separatorState(column);
  expect(columnMaximum.value).toBeCloseTo(columnMaximum.maximum, 0);
  await column.press("Home");
  for (let index = 0; index < 4; index++) await column.press("ArrowRight");

  const composerBefore = await separatorState(composer);
  await dragSeparator(page, composer, 0, -40);
  const composerDragged = await separatorState(composer);
  expect(composerDragged.value).toBeGreaterThan(composerBefore.value + 10);
  const height = await frame
    .locator("#composer")
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(height).toBeCloseTo(composerDragged.value, 0);
  await composer.focus();
  await composer.press("ArrowDown");
  expect((await separatorState(composer)).value).toBeLessThan(
    composerDragged.value,
  );
  await composer.press("Home");
  await composer.press("ArrowDown");
  const composerMinimum = await separatorState(composer);
  expect(composerMinimum.value).toBeCloseTo(composerMinimum.minimum, 0);
  await composer.press("End");
  await composer.press("ArrowUp");
  const composerMaximum = await separatorState(composer);
  expect(composerMaximum.value).toBeCloseTo(composerMaximum.maximum, 0);

  await resizeViewport(page, frame, { width: 540, height: 620 });
  await expect(column).not.toBeVisible();
  await expect(column).toHaveAttribute("aria-disabled", "true");
  await expect(column).toHaveAttribute("tabindex", "-1");
  await separatorState(composer);
  await resizeViewport(page, frame, { width: 1120, height: 450 });
  await expect(column).toBeVisible();
  await expect(column).toHaveAttribute("aria-disabled", "false");
  await separatorState(column);
  const short = await separatorState(composer);
  const shortGeometry = await frame.locator(".chat").evaluate((node) => {
    const bounds = (element) => {
      const { x, y, width, height, bottom, right } =
        element.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      app: bounds(document.querySelector(".app")),
      chat: bounds(node),
      messages: bounds(node.querySelector("#messages")),
      composer: bounds(node.querySelector("#composer")),
      draft: bounds(node.querySelector("#draft")),
      send: bounds(node.querySelector("#send")),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
    };
  });
  expect(shortGeometry.messages.height).toBeGreaterThanOrEqual(99);
  expect(shortGeometry.horizontalOverflow).toBe(false);
  expect(shortGeometry.verticalOverflow).toBe(false);
  for (const key of ["app", "chat", "composer", "draft", "send"]) {
    const bounds = shortGeometry[key];
    expect(bounds.y, key).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom, key).toBeLessThanOrEqual(
      shortGeometry.viewport.height + 1,
    );
    expect(bounds.right, key).toBeLessThanOrEqual(
      shortGeometry.viewport.width + 1,
    );
    expect(bounds.width, key).toBeGreaterThan(0);
    expect(bounds.height, key).toBeGreaterThan(0);
  }
  await expect(frame.locator("#draft")).toBeInViewport();
  await expect(frame.locator("#send")).toBeInViewport();
  await expect(frame.locator("#draft")).toBeEnabled();
  await expect(frame.locator("#send")).toBeEnabled();
  await frame.locator("#draft").focus();
  await frame.locator("#draft").press("Tab");
  await expect(frame.locator("#send")).toBeFocused();
  expect(shortGeometry.composer.height).toBeCloseTo(short.value, 0);
  await resizeViewport(page, frame, originalViewport);
  await expect(frame.locator("html")).toHaveCSS("font-size", profile.font);
  await composer.focus();
  await composer.press("Home");
  for (let index = 0; index < 3; index++) await composer.press("ArrowUp");
  const retained = await separatorState(composer);
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(
          () => window.__sdkSnapshot.checkpoint?.layout?.composerHeight,
        ),
    )
    .toBe(retained.value);
  const preferences = await frame
    .locator("html")
    .evaluate(() => window.__sdkSnapshot.checkpoint.layout);
  expect(preferences.conversationWidth).toBeGreaterThanOrEqual(
    columnMinimum.minimum,
  );
  return {
    header,
    listActions,
    avatars,
    fontSizes,
    pointerDrag: {
      columnBefore,
      columnDragged,
      composerBefore,
      composerDragged,
    },
    keyboardBoundaries: {
      columnMinimum,
      columnMaximum,
      composerMinimum,
      composerMaximum,
    },
    narrowColumnDisabled: true,
    shortGeometry,
    preferences,
  };
}

export async function changeLanLayoutForImport(page, frame, customization) {
  const viewport = page.viewportSize();
  const column = frame.locator("#conversation-resizer");
  if (!(await column.isVisible()))
    await resizeViewport(page, frame, { width: 1120, height: 800 });
  await column.focus();
  await column.press("ArrowRight");
  const composer = frame.locator("#composer-resizer");
  await composer.focus();
  await composer.press("ArrowUp");
  await expect
    .poll(() =>
      frame.locator("html").evaluate((_node, previous) => {
        const current = window.__sdkSnapshot.checkpoint?.layout;
        return (
          !!current &&
          current.conversationWidth !== previous.conversationWidth &&
          current.composerHeight !== previous.composerHeight
        );
      }, customization.preferences),
    )
    .toBe(true);
  customization.changedBeforeImport = await frame
    .locator("html")
    .evaluate(() => window.__sdkSnapshot.checkpoint.layout);
  await resizeViewport(page, frame, viewport);
}

export async function assertLanLayoutRestored(frame, customization, phase) {
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.layout),
    )
    .toEqual(customization.preferences);
  expect(
    (await separatorState(frame.locator("#composer-resizer"))).value,
  ).toBeCloseTo(customization.preferences.composerHeight, 0);
  if (await frame.locator("#conversation-resizer").isVisible())
    expect(
      (await separatorState(frame.locator("#conversation-resizer"))).value,
    ).toBeCloseTo(customization.preferences.conversationWidth, 0);
  customization[
    phase === "import"
      ? "restoredAfterSessionImport"
      : "restoredAfterHostReload"
  ] = true;
}

/** Packaged chat HTML and SDK; TCP, pickers and saving use explicit boundaryMock services. */
export async function checkLanChat({
  page,
  frame,
  services,
  profile,
  capturePrefix,
}) {
  const serviceCallsBefore = services.calls.length;
  const editorLayout = await frame
    .locator("#composer-editor")
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const send = document.getElementById("send").getBoundingClientRect();
      const count = document
        .getElementById("draft-count")
        .getBoundingClientRect();
      const tools = document
        .querySelector(".composer-tools")
        .getBoundingClientRect();
      return {
        bounds: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
        send: { right: send.right, bottom: send.bottom, top: send.top },
        count: { left: count.left, bottom: count.bottom },
        tools: tools.height,
        border: getComputedStyle(document.querySelector(".contacts"))
          .borderRightWidth,
      };
    });
  expect(editorLayout.send.right).toBeLessThanOrEqual(
    editorLayout.bounds.right,
  );
  expect(editorLayout.send.bottom).toBeLessThanOrEqual(
    editorLayout.bounds.bottom,
  );
  expect(editorLayout.send.top).toBeGreaterThanOrEqual(editorLayout.bounds.top);
  expect(editorLayout.count.left).toBeGreaterThanOrEqual(
    editorLayout.bounds.left,
  );
  expect(editorLayout.count.bottom).toBeLessThanOrEqual(
    editorLayout.bounds.bottom,
  );
  expect(editorLayout.tools).toBeLessThanOrEqual(
    parseFloat(profile.font) * 1.75 + 1,
  );
  expect(editorLayout.border).toBe("0px");
  const searchIcon = frame.locator(".search-wrap svg");
  const visibleIcon = await searchIcon.screenshot({ animations: "disabled" });
  await searchIcon.evaluate((node) => {
    node.style.opacity = "0";
  });
  const hiddenIcon = await searchIcon.screenshot({ animations: "disabled" });
  await searchIcon.evaluate((node) => {
    node.style.removeProperty("opacity");
  });
  expect(
    visibleIcon.equals(hiddenIcon),
    "search glyph is actually painted above its input",
  ).toBe(false);
  await expect(frame.locator("#add-contact,#peer-count")).toHaveCount(0);
  const headingAlignment = await frame
    .locator(".list-heading")
    .evaluate((node) => {
      const title = node.querySelector("h1").getBoundingClientRect();
      const button = node
        .querySelector("#settings-toggle")
        .getBoundingClientRect();
      return Math.abs(
        title.y + title.height / 2 - button.y - button.height / 2,
      );
    });
  expect(headingAlignment).toBeLessThanOrEqual(1);
  for (const selector of [
    "body",
    ".app",
    ".contacts",
    ".chat",
    ".messages",
    ".composer",
    ".resize-handle",
  ])
    await expect(frame.locator(selector).first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
  const settings = frame.locator("#settings-panel");
  const toggle = frame.locator("#settings-toggle");
  await expect(settings).not.toBeVisible();
  await expect(frame.locator("#start")).not.toBeVisible();
  await expect(frame.locator("#address")).not.toBeVisible();
  await toggle.focus();
  await toggle.press("Enter");
  await expect(settings).toBeVisible();
  await frame.locator("#nickname").focus();
  await frame.locator("#nickname").press("Escape");
  await expect(settings).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(frame.locator("#nickname")).toHaveValue("Fixture device");
  await expect(frame.locator("#rename")).toBeEnabled();
  const settingsPanelGeometry = await checkSettingsPanel(
    page,
    frame,
    capturePrefix,
  );
  if (
    !(await frame.locator("#manual-connection").evaluate((node) => node.open))
  )
    await frame.locator("#manual-connection > summary").click();
  await frame.locator("#address").fill("192.168.1.21");
  const connectionControls = await settings
    .locator("#nickname,#port,#start,#stop,#address,#remote-port,#connect")
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (node) =>
            node.getBoundingClientRect().width > 0 &&
            node.getBoundingClientRect().height > 0,
        )
        .map((node) => {
          const bounds = node.getBoundingClientRect();
          return {
            id: node.id,
            width: bounds.width,
            height: bounds.height,
            right: bounds.right,
            viewport: innerWidth,
          };
        }),
    );
  for (const control of connectionControls) {
    expect(control.width, control.id).toBeGreaterThanOrEqual(24);
    expect(control.height, control.id).toBeGreaterThanOrEqual(24);
    expect(control.right, control.id).toBeLessThanOrEqual(control.viewport);
  }
  await expect(frame.locator(".service-toggle button:visible")).toHaveCount(1);
  await expect(frame.locator("#nickname")).toHaveValue("Fixture device");
  if (await frame.locator("#stop").isEnabled()) {
    await frame.locator("#stop").click();
    await expect(frame.locator("#start")).toBeEnabled();
  }
  await frame.locator("#nickname").fill("Fixture tester");
  await frame.locator("#start").click();
  await expect(frame.locator("#stop")).toBeEnabled();
  await expect(frame.locator("#addresses")).toContainText("192.168.1.20:45873");
  await expect(frame.locator("#addresses")).toHaveAttribute(
    "aria-label",
    /192\.168\.1\.20:45873/,
  );
  await frame.locator("#close-settings").click();
  const nearby = frame.locator(
    '#nearby-devices [data-discovered="' + "b".repeat(32) + '"]',
  );
  await expect(nearby).toBeVisible();
  await expect(nearby).toContainText("Fixture friend");
  await nearby.click();
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(1);
  const contactMetrics = await frame
    .locator("#contacts [data-peer]")
    .first()
    .evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      lineHeight: getComputedStyle(node).lineHeight,
      padding: getComputedStyle(node).padding,
      copyHeight: node.querySelector(".contact-copy").getBoundingClientRect()
        .height,
    }));
  expect(
    contactMetrics.height,
    JSON.stringify(contactMetrics),
  ).toBeLessThanOrEqual(parseFloat(profile.font) * 3.5);
  await expect(nearby).toHaveCount(0);
  await expect(frame.locator("#peer-detail")).toContainText("192.168.1.10");

  const draft = frame.locator("#draft");
  const messages = frame.locator("#messages");
  await draft.fill("Fixture message 你好");
  await frame.locator("#send").click();
  await expect(draft).toHaveValue("");
  await expect(messages).toContainText("Fixture message 你好");
  const sends = () =>
    services.calls
      .slice(serviceCallsBefore)
      .filter(
        (call) => call.service === "lan" && call.request.action === "send",
      );
  const sendsBefore = sends().length;
  await draft.fill("Multiline draft");
  await draft.press("Shift+Enter");
  await expect(draft).toHaveValue("Multiline draft\n");
  expect(sends()).toHaveLength(sendsBefore);
  await draft.fill("IME draft");
  await draft.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    bubbles: true,
  });
  await expect(draft).toHaveValue("IME draft");
  expect(sends()).toHaveLength(sendsBefore);
  await draft.fill("Keyboard message");
  await draft.press("Enter");
  await expect(draft).toHaveValue("");
  await expect(messages).toContainText("Keyboard message");

  await draft.fill("fixture-failed-send");
  await frame.locator("#send").click();
  await expect(frame.locator("#send")).toBeEnabled();
  await expect(draft).toHaveValue("fixture-failed-send");
  await expect(messages).not.toContainText("fixture-failed-send");
  const expectedErrorToast = page
    .locator('[data-sonner-toast][data-type="error"]')
    .last();
  await expect(expectedErrorToast).toBeVisible();
  // 移开真实指针，让 Sonner 恢复默认 4 秒倒计时，避免悬停暂停后挡住窄屏设置入口。
  await frame.locator(".chat-head").hover({ position: { x: 12, y: 12 } });
  await expect(expectedErrorToast).not.toBeVisible({ timeout: 10000 });

  await toggle.click();
  await frame.locator("#stop").click();
  await expect(frame.locator("#start")).toBeEnabled();
  await frame.locator("#loopback-settings > summary").click();
  await frame.locator("#loopback").click();
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(2);
  await expect(frame.locator("#contacts")).toContainText("Boundary echo peer");
  await expect(frame.locator("#peer-name")).toHaveText("Boundary echo peer");
  await expect(frame.locator("#addresses")).toContainText("127.0.0.1");
  await frame.locator("#close-settings").click();
  await draft.fill("Boundary loopback message");
  await draft.press("Enter");
  await expect(
    messages.getByText("Boundary loopback message", { exact: true }),
  ).toHaveCount(2);

  await draft.fill("Emoji draft ");
  await frame.locator("#emoji-toggle").click();
  await expect(frame.locator("#emoji-picker")).toBeVisible();
  await frame.locator("#emoji-tab").click();
  const emoji = frame.locator("#emoji-grid [data-emoji]").first();
  const emojiText = await emoji.getAttribute("data-emoji");
  await emoji.click();
  await expect(draft).toHaveValue("Emoji draft " + emojiText);
  if (!(await frame.locator("#emoji-picker").isVisible()))
    await frame.locator("#emoji-toggle").click();
  await frame.locator("#sticker-tab").click();
  await frame.locator("#emoji-grid [data-sticker]").first().click();
  await expect.poll(() => sends().at(-1)?.request.kind).toBe("sticker");
  await expect(draft).toHaveValue("Emoji draft " + emojiText);
  if (await frame.locator("#emoji-picker").isVisible())
    await frame.locator("#emoji-toggle").click();

  await frame.locator("#send-image").click();
  const image = messages.locator(".image-attachment");
  await expect(image).toHaveCount(2);
  await expect(image.locator(".image-thumbnail")).toHaveCount(2);
  await expect
    .poll(() =>
      image
        .locator(".image-thumbnail")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await expect(
    image.locator(".file-name,.attachment-actions,.save-attachment"),
  ).toHaveCount(0);
  expect(
    services.calls
      .slice(serviceCallsBefore)
      .filter(
        (call) =>
          call.service === "lan" && call.request.action === "previewAttachment",
      ),
  ).toHaveLength(0);
  const thumbnailCalls = services.calls
    .slice(serviceCallsBefore)
    .filter(
      (call) =>
        call.service === "lan" && call.request.action === "thumbnailAttachment",
    );
  expect(thumbnailCalls.length).toBeGreaterThanOrEqual(2);
  const thumbnail = image.first().locator(".preview-attachment");
  const thumbnailSize = await thumbnail.evaluate((node) => {
    const image = node.querySelector("img");
    const outer = node.getBoundingClientRect();
    const inner = image.getBoundingClientRect();
    return {
      width: outer.width,
      height: outer.height,
      imageWidth: inner.width,
      imageHeight: inner.height,
      ratio: image.naturalWidth / image.naturalHeight,
    };
  });
  expect(
    Math.abs(thumbnailSize.width / thumbnailSize.height - thumbnailSize.ratio),
  ).toBeLessThan(0.01);
  expect(
    Math.abs(thumbnailSize.height - thumbnailSize.imageHeight),
  ).toBeLessThanOrEqual(1);
  await thumbnail.click({ button: "right" });
  const attachmentMenu = frame.locator("#attachment-menu");
  await expect(attachmentMenu).toBeVisible();
  await expect(frame.locator("#attachment-menu-view")).toBeFocused();
  await page.screenshot({ path: capturePrefix + "-image-menu.png" });
  await frame.locator("#attachment-menu-view").click();
  const preview = frame.locator("#attachment-preview");
  await expect(preview).toBeVisible();
  await expect(frame.locator("#preview-image")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await expect(frame.locator("#preview-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(frame.locator("#preview-image")).toHaveJSProperty(
    "naturalWidth",
    1600,
  );
  const previewSize = await frame
    .locator("#preview-viewport")
    .evaluate((node) => {
      const image = node.querySelector("img");
      const rect = node.getBoundingClientRect();
      const content = image.getBoundingClientRect();
      const toolbar = document
        .querySelector(".preview-tools")
        .getBoundingClientRect();
      const scale = document
        .getElementById("preview-scale")
        .getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        imageWidth: content.width,
        imageHeight: content.height,
        toolbar: toolbar.height,
        scale: scale.height,
      };
    });
  expect(
    Math.abs(previewSize.width - previewSize.imageWidth),
    JSON.stringify(previewSize),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(previewSize.height - previewSize.imageHeight),
    JSON.stringify(previewSize),
  ).toBeLessThanOrEqual(1);
  expect(previewSize.toolbar).toBeLessThanOrEqual(
    parseFloat(profile.font) * 2.25,
  );
  expect(previewSize.scale).toBeLessThanOrEqual(parseFloat(profile.font) * 2);
  const pinch = await frame.locator("#preview-viewport").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -2,
      deltaMode: 0,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    });
    const before = visualViewport.scale;
    node.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      before,
      after: visualViewport.scale,
    };
  });
  expect(pinch.prevented).toBe(true);
  expect(pinch.after).toBe(pinch.before);
  await expect(frame.locator("#preview-scale")).toHaveText("102%");
  await frame.locator("#preview-reset").click();
  await frame.locator("#preview-zoom-in").click();
  await expect(frame.locator("#preview-scale")).toHaveText("125%");
  await page.screenshot({ path: capturePrefix + "-image-preview.png" });
  await frame.locator("#preview-reset").click();
  await expect(frame.locator("#preview-scale")).toHaveText("100%");
  await expect(frame.locator("#save-preview")).toHaveCount(0);
  services.cancelNextLanSave();
  await frame.locator("#close-preview").focus();
  await frame.locator("#close-preview").press("Tab");
  await expect(frame.locator("#preview-viewport")).toBeFocused();
  await frame.locator("#preview-viewport").press("Tab");
  await expect(frame.locator("#preview-zoom-out")).toBeFocused();
  await frame.locator("#preview-zoom-out").press("Shift+Tab");
  await expect(frame.locator("#preview-viewport")).toBeFocused();
  await frame.locator("#preview-viewport").press("Shift+F10");
  await expect(attachmentMenu).toBeVisible();
  await frame.locator("#attachment-menu-save").click();
  await expect(attachmentMenu).not.toBeVisible();
  await expect(preview).toBeVisible();
  await preview.press("Escape");
  await expect(preview).not.toBeVisible();

  const imageCount = await image.count();
  const actionStability = await checkActionStability(page, frame);
  services.cancelNextLanAttachment();
  await frame.locator("#send-image").click();
  await expect(frame.locator("#send-image")).toBeEnabled();
  await expect(image).toHaveCount(imageCount);
  await expect(draft).toHaveValue("Emoji draft " + emojiText);
  await frame.locator("#send-file").click();
  const file = messages.locator(".attachment-card").filter({
    hasText: "boundary-fixture.txt",
  });
  await expect(file).toHaveCount(2);
  await expect(file.first()).toContainText("64.0 MiB");
  await expect(file.locator(".save-attachment")).toHaveCount(0);
  await file.first().click({ button: "right" });
  await expect(frame.locator("#attachment-menu-view")).toBeHidden();
  await expect(frame.locator("#attachment-menu-save")).toBeFocused();
  await frame.locator("#attachment-menu-save").click();
  await expect(file.first()).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__extensionUiTest.serviceCalls.filter(
            (call) =>
              call.service === "lan" &&
              call.request.action === "saveAttachment" &&
              call.completed,
          ).length,
      ),
    )
    .toBe(2);
  const saves = await page.evaluate(() =>
    window.__extensionUiTest.serviceCalls
      .filter(
        (call) =>
          call.service === "lan" && call.request.action === "saveAttachment",
      )
      .map((call) => call.response),
  );
  expect(saves.map((result) => result.cancelled)).toEqual([true, false]);
  expect(saves.at(-1).name).toBe("boundary-fixture.txt");
  const incomingTransfer = {
    id: "f".repeat(32),
    peerId: "e".repeat(32),
    direction: "incoming",
    kind: "file",
    name: "very-long-file-name-for-progress-layout-boundary-fixture.bin",
    bytes: 300 * 1024 * 1024,
    phase: "receiving",
    completedBytes: 150 * 1024 * 1024,
    totalBytes: 300 * 1024 * 1024,
    startedAt: Date.now(),
  };
  services.setLanTransfers([incomingTransfer]);
  const transferPanel = frame.locator(
    '#messages .attachment-card[data-message="' + incomingTransfer.id + '"]',
  );
  await expect(frame.locator("#transfer-progress")).toHaveCount(0);
  await expect(transferPanel).toBeVisible();
  await expect(transferPanel).toContainText("50%");
  await expect(transferPanel.locator("progress")).toHaveJSProperty(
    "value",
    incomingTransfer.completedBytes,
  );
  await transferPanel.scrollIntoViewIfNeeded();
  const transferGeometry = await transferPanel.evaluate((node) => {
    const panel = node.getBoundingClientRect();
    const composer = document
      .getElementById("composer")
      .getBoundingClientRect();
    return {
      right: panel.right,
      bottom: panel.bottom,
      composerTop: composer.top,
      viewport: innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      insideBubble: node.contains(node.querySelector(".attachment-progress")),
      incoming: !node.closest("article").classList.contains("outgoing"),
    };
  });
  expect(transferGeometry.right).toBeLessThanOrEqual(transferGeometry.viewport);
  expect(transferGeometry.bottom).toBeLessThanOrEqual(
    transferGeometry.composerTop,
  );
  expect(transferGeometry.horizontalOverflow).toBe(false);
  expect(transferGeometry.insideBubble).toBe(true);
  expect(transferGeometry.incoming).toBe(true);
  await page.screenshot({ path: capturePrefix + "-transfer-progress.png" });
  services.setLanTransfers([]);
  await expect(transferPanel).not.toBeVisible();

  await draft.fill("Retained unsent draft");
  await frame.locator('#contacts [data-peer="' + "b".repeat(32) + '"]').click();
  await expect(draft).toHaveValue("fixture-failed-send");
  await draft.fill("Other conversation draft");
  await frame.locator('#contacts [data-peer="' + "e".repeat(32) + '"]').click();
  await expect(draft).toHaveValue("Retained unsent draft");
  await frame.locator("#search").fill("Boundary echo");
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(1);
  await frame.locator("#search").fill("");
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(2);
  const layoutCustomization = await checkLayoutCustomization(
    page,
    frame,
    profile,
  );
  const layout = await frame.locator(".chat").evaluate((node) => ({
    headerBottom: node.querySelector(".chat-head").getBoundingClientRect()
      .bottom,
    logTop: node.querySelector("#messages").getBoundingClientRect().top,
    logBottom: node.querySelector("#messages").getBoundingClientRect().bottom,
    composerTop: node.querySelector("#composer").getBoundingClientRect().top,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  expect(layout.headerBottom).toBeLessThanOrEqual(layout.logTop + 1);
  expect(layout.logBottom).toBeLessThanOrEqual(layout.composerTop + 1);
  expect(layout.horizontalOverflow).toBe(false);
  expect(layout.reducedMotion).toBe(true);
  const exportStart = await page.evaluate(() => ({
    at: performance.timeOrigin + performance.now(),
    artifacts: window.__extensionUiTest.artifacts.length,
  }));
  await frame.locator("#conversation-more").click();
  await frame.locator("#export").click();
  // 导出运行真实 Wasm：15 秒 worker 预算之外，还需桥接回执和保存产物。
  const exportBudgetMs = 25000;
  try {
    await expect
      .poll(
        () => page.evaluate(() => window.__extensionUiTest.artifacts.length),
        {
          timeout: exportBudgetMs,
          message:
            "LAN transcript export adds a saved artifact within the Wasm and bridge budget",
        },
      )
      .toBeGreaterThan(exportStart.artifacts);
  } catch (error) {
    const diagnostics = await page.evaluate(
      (startedAt) => ({
        elapsedMs: performance.timeOrigin + performance.now() - startedAt,
        artifacts: window.__extensionUiTest.artifacts.length,
        lifecycle: window.__extensionUiTest.lifecycle.filter(
          (event) => event.at >= startedAt,
        ),
        protocol: window.__iframeProtocolRequests.filter(
          (event) => event.at >= startedAt,
        ),
        protocolErrors: window.__protocolErrors.filter(
          (event) => event.at >= startedAt,
        ),
        hostBusy: window.__latestHostBusy,
      }),
      exportStart.at,
    );
    throw new Error(
      "LAN transcript export failed: " + JSON.stringify(diagnostics),
      { cause: error },
    );
  }
  const exportElapsedMs = await page.evaluate(
    (startedAt) => performance.timeOrigin + performance.now() - startedAt,
    exportStart.at,
  );
  await expect(draft).toHaveValue("Retained unsent draft");
  expect(
    await page.evaluate(
      () => window.__extensionUiTest.artifacts.at(-1).content,
    ),
  ).toContain("Boundary loopback message");
  await expect(frame.locator("#layout")).toHaveAttribute("aria-busy", "false");
  if (!(await frame.locator("#conversation-menu").isVisible()))
    await frame.locator("#conversation-more").click();
  await frame.locator("#clear-conversation").click();
  await expect(frame.locator("#confirmation-text")).toContainText(
    "Boundary echo peer",
  );
  await expect(frame.locator("#confirmation-text")).toContainText(
    /图片和文件|images and cached files/,
  );
  await frame.locator("#cancel-action").click();
  await expect(frame.locator("#conversation-more")).toBeFocused();
  await expect(file).toHaveCount(2);
  await frame.locator("#conversation-more").click();
  await frame.locator("#clear-conversation").click();
  await frame.locator("#confirm-action").click();
  await expect(messages.locator(".message")).toHaveCount(0);
  await expect(messages.locator(".attachment-card")).toHaveCount(0);
  await expect(draft).toHaveValue("Retained unsent draft");
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(2);
  await expect(frame.locator("#conversation-more")).toBeFocused();
  const scopedClear = services.calls
    .filter(
      (call) =>
        call.service === "lan" && call.request.action === "clearHistory",
    )
    .at(-1);
  expect(scopedClear.request.peerId).toBe("e".repeat(32));
  await frame.locator('#contacts [data-peer="' + "b".repeat(32) + '"]').click();
  await expect(messages).toContainText("Fixture message 你好");
  await expect(draft).toHaveValue("Other conversation draft");
  await frame.locator('#contacts [data-peer="' + "e".repeat(32) + '"]').click();
  await expect(draft).toHaveValue("Retained unsent draft");
  return {
    boundaryMock: true,
    nativeTcp: false,
    nativeDialogs: false,
    profile,
    collapsedSettings: true,
    connectionControls,
    settingsPanelGeometry,
    editorLayout,
    transferGeometry,
    actionStability,
    nearbyDiscoveryConnects: true,
    escapeRestoresFocus: true,
    keyboardComposer: ["Enter", "Shift+Enter", "IME composition"],
    failedSendRetainsDraft: true,
    expectedErrorToastCleared: true,
    loopbackEchoRendered: true,
    emojiAndSticker: true,
    conversationDraftsAndSearch: true,
    conversationClearKeepsOtherMessagesAndDrafts: true,
    attachments: [
      "thumbnail service",
      "image-only card",
      "context menu",
      "image preview zoom",
      "file save",
      "picker cancel",
      "save cancel",
    ],
    layout,
    layoutCustomization,
    transcriptExport: {
      budgetMs: exportBudgetMs,
      elapsedMs: exportElapsedMs,
      artifactAdded: true,
    },
  };
}

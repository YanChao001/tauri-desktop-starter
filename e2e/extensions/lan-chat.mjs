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
async function checkSettingsModes(page, frame) {
  const originalViewport = page.viewportSize();
  await resizeViewport(page, frame, { ...originalViewport, height: 450 });
  const initialGeometry = await settingsGeometry(frame, "after-short-resize");
  const before = initialGeometry.panel;
  const viewport = initialGeometry.viewport;
  expect(before.x).toBeGreaterThanOrEqual(0);
  expect(before.y).toBeGreaterThanOrEqual(0);
  expect(before.x + before.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(before.y + before.height).toBeLessThanOrEqual(viewport.height + 1);
  const details = frame.locator("#connection-details");
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", true);
  await settingsGeometry(frame, "details-open");
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
  for (const mode of ["loopback", "lan"]) {
    await frame.locator("#mode-" + mode).click();
    await expect(frame.locator("#" + mode + "-settings")).toBeVisible();
    const modeGeometry = await settingsGeometry(frame, "mode-" + mode);
    expectStableRect(before, modeGeometry.panel, {
      before: initialGeometry,
      after: modeGeometry,
    });
    const after = await scroll();
    expect(Math.abs(after.top - scrolled.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - scrolled.height)).toBeLessThanOrEqual(1);
  }
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", false);
  await resizeViewport(page, frame, originalViewport);
  return {
    rect: before,
    viewport,
    scroll: scrolled,
    modeSwitchRetainsGeometry: true,
  };
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
  const rail = await frame.locator(".rail").evaluate((node) => ({
    width: node.getBoundingClientRect().width,
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
  expect(rail.width).toBeCloseTo(48, 0);
  for (const button of rail.controls) {
    expect(button.width).toBeGreaterThanOrEqual(28);
    expect(button.width).toBeLessThanOrEqual(36);
    expect(button.height).toBeGreaterThanOrEqual(28);
    expect(button.height).toBeLessThanOrEqual(36);
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
    rail,
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
export async function checkLanChat({ page, frame, services, profile }) {
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
  const settingsModeGeometry = await checkSettingsModes(page, frame);
  const connectionControls = await settings
    .locator("#nickname,#port,#start,#stop,#address,#remote-port,#connect")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
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
  const inheritedFont = await frame
    .locator("body")
    .evaluate((node) => getComputedStyle(node).fontFamily);
  await expect(frame.locator("#addresses")).toHaveCSS(
    "font-family",
    inheritedFont,
  );
  await expect(frame.locator("#nickname")).toHaveValue("Fixture device");
  await frame.locator("#nickname").fill("Fixture tester");
  await frame.locator("#start").click();
  await expect(frame.locator("#stop")).toBeEnabled();
  await frame.locator("#address").fill("192.168.1.21");
  await frame.locator("#connect").click();
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(1);
  await frame.locator("#close-settings").click();

  const draft = frame.locator("#draft");
  const messages = frame.locator("#messages");
  await draft.fill("Fixture message 你好");
  await frame.locator("#send").click();
  await expect(draft).toHaveValue("");
  await expect(messages).toContainText("Fixture message 你好");
  const sends = () =>
    services.calls.filter(
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
  await frame.locator("#mode-loopback").click();
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
  const image = messages.locator(".attachment-card").filter({
    hasText: "boundary-fixture.png",
  });
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
  await image.first().locator(".preview-attachment").click();
  const preview = frame.locator("#attachment-preview");
  await expect(preview).toBeVisible();
  await expect(frame.locator("#preview-image")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  services.cancelNextLanSave();
  await frame.locator("#save-preview").click();
  await expect(frame.locator("#save-preview")).toBeEnabled();
  await expect(preview).toBeVisible();
  await preview.press("Escape");
  await expect(preview).not.toBeVisible();

  const imageCount = await image.count();
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
  await file.first().locator(".save-attachment").click();
  await expect(file.first().locator(".save-attachment")).toBeEnabled();
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
  return {
    boundaryMock: true,
    nativeTcp: false,
    nativeDialogs: false,
    profile,
    collapsedSettings: true,
    connectionControls,
    settingsModeGeometry,
    escapeRestoresFocus: true,
    keyboardComposer: ["Enter", "Shift+Enter", "IME composition"],
    failedSendRetainsDraft: true,
    expectedErrorToastCleared: true,
    loopbackEchoRendered: true,
    emojiAndSticker: true,
    conversationDraftsAndSearch: true,
    attachments: ["image preview", "file save", "picker cancel", "save cancel"],
    layout,
    layoutCustomization,
    transcriptExport: {
      budgetMs: exportBudgetMs,
      elapsedMs: exportElapsedMs,
      artifactAdded: true,
    },
  };
}

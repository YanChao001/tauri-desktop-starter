import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const checkpoint = (frame) =>
  frame.locator("html").evaluate(() => window.__sdkSnapshot?.checkpoint);
const ticks = (value) =>
  value.inputs.reduce((count, input) => count + input[2], 0);

async function pause(page, frame) {
  await frame.locator("#board").focus();
  await page.keyboard.press("KeyP");
  await expect(frame.locator("#overlay")).toBeVisible();
}

async function snapshot(page, output, profile, scene, session) {
  const filename = `snake-${profile.language}-${profile.width}-${scene}.png`;
  if (session) {
    const { data } = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(join(output, filename), Buffer.from(data, "base64"));
  } else await page.screenshot({ path: join(output, filename) });
  return filename;
}

async function accessible(page, scene) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
    scene,
  ).toEqual([]);
  return { scene, violations: violations.length };
}

async function checkOverlayFocus(page, frame) {
  const overlay = frame.locator("#overlay");
  await expect(overlay).toHaveAttribute("role", "dialog");
  await expect(overlay).toHaveAttribute("aria-modal", "true");
  await expect(overlay).toHaveAccessibleName(/.+/);
  await expect(frame.locator("#board")).toHaveJSProperty("inert", true);
  await frame.locator("#start").focus();
  const focused = [];
  for (const key of [
    "Shift+Tab",
    "Tab",
    "Tab",
    "Tab",
    "Tab",
    "Tab",
    "Shift+Tab",
  ]) {
    await page.keyboard.press(key);
    const item = await overlay.evaluate((node) => ({
      id: document.activeElement.id,
      inside: node.contains(document.activeElement),
    }));
    expect(item.inside, key + " reached " + item.id).toBe(true);
    focused.push(item.id);
  }
  await frame.locator("#start").focus();
  return {
    modalAccessibleName: true,
    canvasInert: true,
    focusRemainsInDialog: focused,
  };
}

async function checkSoundSettings(page, frame) {
  const trigger = frame.locator("#sound-settings");
  const panel = frame.locator("#sound-panel");
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAccessibleName(/.+/);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(frame.locator("#volume")).toBeFocused();
  await frame.locator("#sound").click();
  await expect.poll(async () => (await checkpoint(frame)).muted).toBe(true);
  await expect(frame.locator("#sound")).toHaveAttribute("aria-pressed", "true");
  await frame.locator("#sound").click();
  await expect.poll(async () => (await checkpoint(frame)).muted).toBe(false);
  await expect(frame.locator("#sound")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await frame.locator("#volume").focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < 37; step++) await page.keyboard.press("ArrowRight");
  await expect(frame.locator("#volume")).toHaveValue("37");
  await expect(frame.locator("#volume-value")).toHaveText("37%");
  await expect.poll(async () => (await checkpoint(frame)).volume).toBe(37);
  await frame.locator("#sound-close").click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await frame.locator("#title").click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await frame.locator("#skins-button").click();
  await expect(panel).toBeHidden();
  await expect(frame.locator("#skins-screen")).toBeVisible();
  await frame.locator("#home-button").click();
  return {
    singlePanel: true,
    mutePressedMeansMuted: true,
    liveVolumePercent: 37,
    closeEscapeAndOutsideRestoreFocus: true,
    navigationClosesPanel: true,
  };
}

async function measureLayout(frame, screen) {
  const geometry = await frame.locator("html").evaluate((_node, scene) => {
    const rect = (id) => {
      const element = document.getElementById(id);
      const box = element.getBoundingClientRect();
      return {
        id,
        visible: !element.hidden && box.width > 0 && box.height > 0,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      };
    };
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        font: getComputedStyle(document.documentElement).fontSize,
      },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      nav: rect("menu-nav"),
      content: rect(scene + "-screen"),
      bottom: rect("menu-bottom"),
      footer: rect("home-footer"),
      tools: rect("home-tools"),
      trigger: rect("sound-settings"),
      spectate: rect("spectate"),
    };
  }, screen);
  expect(geometry.overflow).toBe(false);
  for (const item of [
    geometry.nav,
    geometry.content,
    geometry.bottom,
    geometry.tools,
    geometry.trigger,
    geometry.spectate,
    geometry.footer,
  ]) {
    if (!item.visible) continue;
    expect(item.left, item.id).toBeGreaterThanOrEqual(-1);
    expect(item.top, item.id).toBeGreaterThanOrEqual(-1);
    expect(item.right, item.id).toBeLessThanOrEqual(
      geometry.viewport.width + 1,
    );
    expect(item.bottom, item.id).toBeLessThanOrEqual(
      geometry.viewport.height + 1,
    );
  }
  expect(geometry.nav.bottom).toBeLessThanOrEqual(geometry.content.top + 1);
  expect(geometry.content.bottom).toBeLessThanOrEqual(geometry.bottom.top + 1);
  expect(geometry.footer.visible).toBe(screen === "menu");
  if (geometry.footer.visible) {
    const overlapWidth =
      Math.min(geometry.footer.right, geometry.tools.right) -
      Math.max(geometry.footer.left, geometry.tools.left);
    const overlapHeight =
      Math.min(geometry.footer.bottom, geometry.tools.bottom) -
      Math.max(geometry.footer.top, geometry.tools.top);
    expect(overlapWidth > 1 && overlapHeight > 1).toBe(false);
  }
  if (screen === "skins") {
    await frame.locator("#skin-free").scrollIntoViewIfNeeded();
    await expect(frame.locator("#skin-select")).toBeVisible();
    const controls = await frame.locator("#skins-screen").evaluate((node) => {
      const content = node.getBoundingClientRect();
      return ["skin-select", "skin-free"].map((id) => {
        const box = document.getElementById(id).getBoundingClientRect();
        return {
          id,
          top: box.top,
          bottom: box.bottom,
          contentTop: content.top,
          contentBottom: content.bottom,
        };
      });
    });
    for (const control of controls) {
      expect(control.top, control.id).toBeGreaterThanOrEqual(
        control.contentTop - 1,
      );
      expect(control.bottom, control.id).toBeLessThanOrEqual(
        control.contentBottom + 1,
      );
    }
    geometry.skinControls = controls;
  }
  return geometry;
}

async function checkLayoutViewports({ page, frame, profile, output, settled }) {
  const cases =
    profile.width === 1120
      ? [
          {
            name: "888x680-dpr125",
            width: 888,
            height: 680,
            font: "16px",
            dpr: 1.25,
          },
          {
            name: "1110x850-font20",
            width: 1110,
            height: 850,
            font: "20px",
            dpr: 1,
          },
          {
            name: "600x300-short",
            width: 600,
            height: 300,
            font: "16px",
            dpr: 1,
          },
        ]
      : profile.width === 360
        ? [
            {
              name: "window-888x680-dpr125",
              width: 888,
              height: 680,
              font: "16px",
              dpr: 1.25,
              outer: true,
            },
            {
              name: "window-1110x850-font20",
              width: 1110,
              height: 850,
              font: "20px",
              dpr: 1,
              outer: true,
            },
            {
              name: "window-360x600-font20-dpr125",
              width: 360,
              height: 600,
              font: "20px",
              dpr: 1.25,
              outer: true,
            },
          ]
        : [];
  const results = [];
  const originalViewport = page.viewportSize();
  const originalFont = await page.evaluate(
    () => document.documentElement.style.fontSize,
  );
  const session = cases.length
    ? await page.context().newCDPSession(page)
    : null;
  let currentTarget;
  try {
    for (const target of cases) {
      currentTarget = target;
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = font;
      }, target.font);
      await expect
        .poll(() =>
          frame
            .locator("html")
            .evaluate((node) => getComputedStyle(node).fontSize),
        )
        .toBe(target.font);
      for (let attempt = 0; attempt < (target.outer ? 1 : 3); attempt++) {
        const size = page.viewportSize();
        const actual = await frame
          .locator("html")
          .evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const outer = target.outer
          ? { width: target.width, height: target.height }
          : {
              width: Math.round(size.width + target.width - actual.width),
              height: Math.round(size.height + target.height - actual.height),
            };
        await page.setViewportSize(outer);
        await session.send("Emulation.setDeviceMetricsOverride", {
          ...outer,
          deviceScaleFactor: target.dpr,
          mobile: false,
        });
        await settled();
      }
      await frame.locator("#home-button").click();
      await settled();
      const menu = await measureLayout(frame, "menu");
      if (target.outer) {
        const outer = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
        }));
        expect(outer).toEqual({ width: target.width, height: target.height });
        menu.outerViewport = outer;
      } else {
        expect(
          Math.abs(menu.viewport.width - target.width),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(menu.viewport.height - target.height),
        ).toBeLessThanOrEqual(1);
      }
      expect(menu.viewport.dpr).toBe(target.dpr);
      const menuScreenshot = await snapshot(
        page,
        output,
        profile,
        `layout-${target.name}-menu`,
        session,
      );
      await frame.locator("#sound-settings").click();
      await expect(frame.locator("#sound-panel")).toBeVisible();
      const panel = await frame.locator("#sound-panel").evaluate((node) => {
        const box = node.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: innerWidth,
          height: innerHeight,
        };
      });
      expect(panel.left).toBeGreaterThanOrEqual(-1);
      expect(panel.top).toBeGreaterThanOrEqual(-1);
      expect(panel.right).toBeLessThanOrEqual(panel.width + 1);
      expect(panel.bottom).toBeLessThanOrEqual(panel.height + 1);
      const soundScreenshot = await snapshot(
        page,
        output,
        profile,
        `layout-${target.name}-sound`,
        session,
      );
      const soundAxe = await accessible(page, target.name + " sound");
      await frame.locator("#sound-close").click();
      await frame.locator("#skins-button").click();
      const skins = await measureLayout(frame, "skins");
      const skinsScreenshot = await snapshot(
        page,
        output,
        profile,
        `layout-${target.name}-skins`,
        session,
      );
      const skinsAxe = await accessible(page, target.name + " skins");
      results.push({
        target,
        menu,
        skins,
        panel,
        screenshots: {
          menu: menuScreenshot,
          skins: skinsScreenshot,
          sound: soundScreenshot,
        },
        accessibility: [soundAxe, skinsAxe],
      });
    }
  } catch (error) {
    await snapshot(
      page,
      output,
      profile,
      `layout-${currentTarget?.name ?? "base"}-failure`,
      session,
    );
    throw error;
  } finally {
    if (session) {
      await session.send("Emulation.clearDeviceMetricsOverride");
      await session.detach();
      await page.setViewportSize(originalViewport);
    }
    await page.evaluate((font) => {
      document.documentElement.style.fontSize = font;
    }, originalFont);
    await expect
      .poll(() =>
        frame
          .locator("html")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe(profile.font);
    await frame.locator("#home-button").click();
    await settled();
  }
  return results;
}

async function checkShortLayer({
  page,
  frame,
  profile,
  output,
  settled,
  layer,
  buttons,
  width,
  height,
}) {
  const original = page.viewportSize();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = await frame
        .locator("html")
        .evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const outer = page.viewportSize();
      await page.setViewportSize({
        width: Math.round(outer.width + width - actual.width),
        height: Math.round(outer.height + height - actual.height),
      });
      await settled();
    }
    const before = await frame.locator("html").evaluate((_node, id) => {
      const node = document.getElementById(id),
        box = node.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        top: box.top,
        bottom: box.bottom,
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        overflowY: getComputedStyle(node).overflowY,
        mainScrollTop: document.querySelector("main").scrollTop,
        canvas: {
          width: board.width,
          height: board.height,
          clientWidth: board.clientWidth,
          clientHeight: board.clientHeight,
          ratio: Math.min(devicePixelRatio || 1, 2),
        },
      };
    }, layer);
    expect(before.viewport).toEqual({ width, height });
    expect(before.mainScrollTop).toBe(0);
    expect(before.canvas.width).toBe(
      Math.round(before.canvas.clientWidth * before.canvas.ratio),
    );
    expect(before.canvas.height).toBe(
      Math.round(before.canvas.clientHeight * before.canvas.ratio),
    );
    const area = await frame.locator(`#${layer}`).boundingBox();
    await page.mouse.move(
      area.x + area.width / 2,
      area.y + Math.min(80, area.height / 2),
    );
    await page.mouse.wheel(0, 2000);
    if (before.scrollHeight > before.clientHeight + 1) {
      expect(before.overflowY).toMatch(/auto|scroll/);
      await expect
        .poll(() =>
          frame.locator(`#${layer}`).evaluate((node) => node.scrollTop),
        )
        .toBeGreaterThan(0);
    }
    const after = await frame.locator("html").evaluate(
      (_node, { layer, buttons }) => {
        const node = document.getElementById(layer),
          box = node.getBoundingClientRect();
        return {
          scrollTop: node.scrollTop,
          mainScrollTop: document.querySelector("main").scrollTop,
          buttons: buttons.map((id) => {
            const r = document.getElementById(id).getBoundingClientRect();
            return {
              id,
              top: r.top,
              bottom: r.bottom,
              layerTop: box.top,
              layerBottom: box.bottom,
            };
          }),
        };
      },
      { layer, buttons },
    );
    expect(after.mainScrollTop).toBe(0);
    for (const button of after.buttons) {
      expect(button.top, button.id).toBeGreaterThanOrEqual(button.layerTop);
      expect(button.bottom, button.id).toBeLessThanOrEqual(button.layerBottom);
    }
    const screenshot = await snapshot(
      page,
      output,
      profile,
      `${layer}-short-${width}x${height}`,
    );
    return {
      before,
      after,
      screenshot,
      realWheelReachesButtons: true,
      canvasTracksCssSize: true,
    };
  } finally {
    await page.setViewportSize(original);
    await settled();
  }
}

async function checkShortArena({ page, frame, profile, output, settled }) {
  const original = page.viewportSize();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = await frame
        .locator("html")
        .evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const outer = page.viewportSize();
      await page.setViewportSize({
        width: Math.round(outer.width + 600 - actual.width),
        height: Math.round(outer.height + 300 - actual.height),
      });
      await settled();
    }
    await frame.locator("#start").click();
    await expect(frame.locator("#overlay")).toBeHidden();
    const geometry = await frame.locator("#game-screen").evaluate((node) => {
      const boxes = [
        ".game-top",
        ".hud-stats",
        ".game-leaderboard",
        ".minimap-shell",
      ].map((selector) => {
        const element = node.querySelector(selector),
          box = element.getBoundingClientRect();
        return {
          selector,
          visible: box.width > 0 && box.height > 0,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      });
      return {
        width: innerWidth,
        height: innerHeight,
        boxes,
        canvas: {
          width: board.width,
          height: board.height,
          cssWidth: board.clientWidth,
          cssHeight: board.clientHeight,
          ratio: Math.min(devicePixelRatio || 1, 2),
        },
      };
    });
    for (const box of geometry.boxes.filter((box) => box.visible)) {
      expect(box.left, box.selector).toBeGreaterThanOrEqual(0);
      expect(box.right, box.selector).toBeLessThanOrEqual(geometry.width);
      expect(box.top, box.selector).toBeGreaterThanOrEqual(0);
      expect(box.bottom, box.selector).toBeLessThanOrEqual(geometry.height);
    }
    const top = geometry.boxes[0],
      stats = geometry.boxes[1];
    expect(stats.top).toBeGreaterThanOrEqual(top.bottom);
    expect(geometry.canvas.width).toBe(
      Math.round(geometry.canvas.cssWidth * geometry.canvas.ratio),
    );
    expect(geometry.canvas.height).toBe(
      Math.round(geometry.canvas.cssHeight * geometry.canvas.ratio),
    );
    const screenshot = await snapshot(
      page,
      output,
      profile,
      "playing-short-600x300",
    );
    await pause(page, frame);
    return {
      geometry,
      screenshot,
      hudWithinViewport: true,
      canvasTracksCssSize: true,
    };
  } finally {
    await page.setViewportSize(original);
    await settled();
  }
}

async function checkTerminalReturn({ page, frame, profile, output, settled }) {
  const tools = profile.language === "zh" ? "扩展工具" : "Extension tools";
  await page.getByRole("button", { name: tools, exact: true }).click();
  await settled();
  const before = await checkpoint(frame);
  await page.waitForTimeout(650);
  expect((await checkpoint(frame)).inputs).toEqual(before.inputs);
  const prefix = {
    ...before,
    seed: 20261026,
    difficulty: "normal",
    inputs: [[0, false, 425]],
  };
  await frame
    .locator("html")
    .evaluate(async (_node, value) => starter.checkpoint(value, false), prefix);
  await expect.poll(async () => ticks(await checkpoint(frame))).toBe(425);
  const old = await page.locator("iframe").elementHandle();
  await page
    .getByRole("menuitem", {
      name: profile.language === "zh" ? "重新加载界面" : "Reload interface",
      exact: true,
    })
    .click();
  await old.waitForElementState("hidden");
  await frame.locator("html").evaluate(async () => {
    window.__sdkSnapshot = await starter.ready;
    starter.onChange((value) => {
      window.__sdkSnapshot = value;
    });
  });
  await expect(frame.locator("#start")).toBeEnabled();
  await expect(frame.locator("#game-screen")).toBeVisible();
  await expect(frame.locator("#overlay")).toBeVisible();
  expect(ticks(await checkpoint(frame))).toBe(425);
  await frame.locator("#start").click();
  await expect(frame.locator("#results")).toBeVisible();
  await expect.poll(async () => ticks(await checkpoint(frame))).toBe(426);
  const verified = await frame.locator("html").evaluate(async () =>
    starter.run("validate", {
      checkpoint: JSON.stringify(window.__sdkSnapshot.checkpoint),
    }),
  );
  expect(verified.description).toMatch(/Wasm/);
  await expect(frame.locator("#start")).toBeVisible();
  await expect(frame.locator("#restart")).toBeHidden();
  await expect(frame.locator("#overlay-menu")).toBeVisible();
  const focus = await checkOverlayFocus(page, frame);
  const shortViewport =
    profile.width === 1120
      ? await checkShortLayer({
          page,
          frame,
          profile,
          output,
          settled,
          layer: "overlay",
          buttons: ["start", "overlay-menu"],
          width: 600,
          height: 300,
        })
      : undefined;
  const screenshot = await snapshot(page, output, profile, "terminal");
  const axe = await accessible(page, "terminal");
  await frame.locator("#overlay-menu").click();
  await expect(frame.locator("#menu-screen")).toBeVisible();
  await expect(frame.locator("#game-screen")).toBeHidden();
  await expect(frame.locator("#menu-start")).toBeFocused();
  expect(ticks(await checkpoint(frame))).toBe(426);
  await frame.locator("#menu-start").click();
  await expect(frame.locator("#confirm")).toBeVisible();
  const shortConfirm =
    profile.width === 1120
      ? await checkShortLayer({
          page,
          frame,
          profile,
          output,
          settled,
          layer: "confirm",
          buttons: ["confirm-restart", "cancel-restart"],
          width: 320,
          height: 200,
        })
      : undefined;
  await frame.locator("#cancel-restart").click();
  await expect(frame.locator("#confirm")).toBeHidden();
  await expect(frame.locator("#menu-start")).toBeFocused();
  expect(ticks(await checkpoint(frame))).toBe(426);
  return {
    reachableBoundaryCollisionTick: 426,
    validatedByRealWasm: true,
    uniqueNewRoundControl: true,
    backToMenuRetainsRun: true,
    cancelNewRoundRestoresFocus: true,
    screenshot,
    shortViewport,
    shortConfirm,
    accessibility: axe,
    focus,
  };
}

async function checkTwoFingerControls(page, frame) {
  const session = await page.context().newCDPSession(page);
  const joystick = await frame.locator("#joystick").boundingBox();
  const boost = await frame.locator("#boost").boundingBox();
  const center = {
    x: joystick.x + joystick.width / 2,
    y: joystick.y + joystick.height / 2,
    id: 1,
  };
  const direction = { ...center, x: center.x - 28, y: center.y - 28 };
  const button = {
    x: boost.x + boost.width / 2,
    y: boost.y + boost.height / 2,
    id: 2,
  };
  await frame.locator("html").evaluate(() => {
    window.__slitherTouchDowns = [];
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch")
        window.__slitherTouchDowns.push({
          target: event.target.closest("button")?.id || event.target.id,
          primary: event.isPrimary,
          pointerId: event.pointerId,
        });
    });
  });
  const send = (type, touchPoints) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints });
  try {
    await send("touchStart", [center]);
    await send("touchMove", [direction]);
    const before = ticks(await checkpoint(frame));
    await send("touchStart", [direction, button]);
    await expect
      .poll(async () => {
        const value = await checkpoint(frame);
        return (
          ticks(value) > before &&
          value.inputs.at(-1)?.[0] === 160 &&
          value.inputs.at(-1)?.[1] === true
        );
      })
      .toBe(true);
    const boosted = ticks(await checkpoint(frame));
    await send("touchEnd", [button]);
    await expect
      .poll(async () => {
        const value = await checkpoint(frame);
        return (
          ticks(value) > boosted &&
          value.inputs.at(-1)?.[0] === 160 &&
          value.inputs.at(-1)?.[1] === false
        );
      })
      .toBe(true);
    const events = await frame
      .locator("html")
      .evaluate(() => window.__slitherTouchDowns);
    expect(
      events.some((event) => event.target === "joystick" && event.primary),
    ).toBe(true);
    expect(
      events.some((event) => event.target === "boost" && !event.primary),
    ).toBe(true);
    return {
      nativeTwoTouchPointers: events,
      secondaryFingerBoosts: true,
      releaseBoostKeepsJoystickDirection: true,
    };
  } finally {
    await send("touchEnd", []);
    await session.detach();
  }
}

// Exercises the packaged UI through real controls and the native offline Wasm
// bridge. Audio lifecycle is observed in Chromium; physical WebView output is
// deliberately outside this fixture's boundary.
export async function checkSlither({
  page,
  frame,
  profile,
  output,
  idle,
  settled,
}) {
  const checks = { difficulties: [], screenshots: {}, accessibility: [] };
  await frame.locator("html").evaluate(() => {
    window.__slitherAudioProbe = { decoded: [], started: [] };
    window.__slitherNameDraws = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      const result = fillText.call(this, text, ...args);
      if (
        this.canvas.id === "board" &&
        document.getElementById("game-screen")?.hidden === false &&
        document.getElementById("overlay")?.hidden === true &&
        window.__slitherNameDraws.length < 2000
      )
        window.__slitherNameDraws.push(String(text));
      return result;
    };
    if (window.AudioContext) {
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (...args) {
        const result = decode.apply(this, args);
        result.then(
          (buffer) =>
            window.__slitherAudioProbe.decoded.push({
              duration: buffer.duration,
              channels: buffer.numberOfChannels,
              length: buffer.length,
            }),
          () => {},
        );
        return result;
      };
    }
    if (window.AudioBufferSourceNode) {
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        const result = start.apply(this, args);
        if (this.buffer)
          window.__slitherAudioProbe.started.push({
            duration: this.buffer.duration,
            loop: this.loop,
          });
        return result;
      };
    }
  });
  await expect(frame.locator("#menu-screen")).toBeVisible();
  await expect(frame.locator("#game-screen")).toBeHidden();
  await expect(frame.locator("#scores-screen")).toBeHidden();
  await frame.locator("#scores-button").click();
  await expect(frame.locator("#scores-screen")).toBeVisible();
  checks.accessibility.push(await accessible(page, "scores"));
  await frame.locator("#back-scores").click();
  await expect(frame.locator("#menu-screen")).toBeVisible();
  await expect(frame.locator("#scores-button")).toBeFocused();
  for (const difficulty of ["easy", "hard", "normal"]) {
    await frame.locator("#difficulty").selectOption(difficulty);
    await expect
      .poll(async () => (await checkpoint(frame))?.difficulty)
      .toBe(difficulty);
    checks.difficulties.push(difficulty);
  }
  await frame.locator("#nickname").fill("Orbit Explorer");
  await frame.locator("#nickname").press("Tab");
  checks.soundSettings = await checkSoundSettings(page, frame);
  await frame.locator("#skins-button").click();
  await expect(frame.locator("#skins-screen")).toBeVisible();
  checks.skinLayout = await measureLayout(frame, "skins");
  checks.screenshots.skins = await snapshot(page, output, profile, "skins");
  checks.accessibility.push(await accessible(page, "skins"));
  const originalSkin = (await checkpoint(frame))?.skin ?? 0;
  await frame.locator("#skin-next").click();
  await frame.locator("#skin-next").click();
  await frame.locator("#skin-prev").click();
  await frame.locator("#skin-select").click();
  await frame.locator("#home-button").click();
  await expect(frame.locator("#menu-screen")).toBeVisible();
  await expect
    .poll(async () => (await checkpoint(frame))?.skin)
    .toBe((originalSkin + 1) % 15);
  checks.preferences = {
    difficulty: "normal",
    nickname: "Orbit Explorer",
    skin: (originalSkin + 1) % 15,
    volume: 37,
    muted: false,
  };
  checks.viewportLayouts = await checkLayoutViewports({
    page,
    frame,
    profile,
    output,
    settled,
  });
  await idle();
  await settled();
  checks.menuLayout = await measureLayout(frame, "menu");
  checks.screenshots.menu = await snapshot(page, output, profile, "menu");
  checks.accessibility.push(await accessible(page, "menu"));
  await expect(frame.locator("#spectate-text")).toBeVisible();
  await expect(frame.locator("#spectate-text")).toHaveText(
    profile.language === "zh" ? "观战" : "Spectate",
  );
  await frame.locator("#spectate").click();
  await expect(frame.locator("#game-screen")).toBeVisible();
  await expect(frame.locator("#board")).toBeVisible();
  await frame.locator("#menu-button").click();
  await expect(frame.locator("#menu-screen")).toBeVisible();
  checks.spectatorRoundTrip = true;
  await frame.locator("html").evaluate(() => {
    window.__slitherNameDraws = [];
  });
  const beforeStartSources = await frame
    .locator("html")
    .evaluate(() => window.__slitherAudioProbe.started.length);
  await frame.locator("#menu-start").click();
  await expect(frame.locator("#game-screen")).toBeVisible();
  await expect(frame.locator("#menu-screen")).toBeHidden();
  await frame.locator("#board").focus();
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__slitherNameDraws.includes("Orbit Explorer")),
    )
    .toBe(true);
  checks.nicknamePaintedInArena = true;
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__slitherAudioProbe.started.length),
    )
    .toBeGreaterThan(beforeStartSources);
  // The fixed opening seed lets the player eat before requesting boost.
  await expect
    .poll(async () => Number(await frame.locator("#score").textContent()))
    .toBeGreaterThan(10);
  const board = await frame.locator("#board").boundingBox();
  expect(board.width).toBeGreaterThan(100);
  expect(board.height).toBeGreaterThan(100);
  await page.mouse.move(
    board.x + board.width * 0.73,
    board.y + board.height * 0.34,
  );
  const beforeBoostTicks = ticks(await checkpoint(frame));
  await page.keyboard.down("Space");
  await expect
    .poll(async () => {
      const value = await checkpoint(frame);
      return (
        ticks(value) > beforeBoostTicks && value.inputs.at(-1)?.[1] === true
      );
    })
    .toBe(true);
  const boostingTicks = ticks(await checkpoint(frame));
  await page.keyboard.up("Space");
  await expect
    .poll(async () => {
      const value = await checkpoint(frame);
      return ticks(value) > boostingTicks && value.inputs.at(-1)?.[1] === false;
    })
    .toBe(true);
  checks.screenshots.playing = await snapshot(page, output, profile, "playing");
  const beforeAudioPause = await frame
    .locator("html")
    .evaluate(() => window.__audioSuspendStates.length);
  await pause(page, frame);
  checks.pauseFocus = await checkOverlayFocus(page, frame);
  await expect
    .poll(async () => {
      const value = await checkpoint(frame);
      return (
        value.inputs.some(([angle]) => angle % 64 !== 0) &&
        value.inputs.some(([, boosting]) => boosting) &&
        value.inputs.at(-1)?.[1] === false
      );
    })
    .toBe(true);
  const firstRun = await checkpoint(frame);
  expect(firstRun.schema).toBe(3);
  expect(firstRun.inputs.length).toBeGreaterThan(0);
  expect(firstRun.inputs.some(([angle]) => angle % 64 !== 0)).toBe(true);
  expect(firstRun.inputs.some(([, boosting]) => boosting === true)).toBe(true);
  expect(firstRun.inputs.some(([, boosting]) => boosting === false)).toBe(true);
  checks.controls = {
    mouseContinuousAngle: true,
    boostPressedAndReleased: true,
    recordedTicks: firstRun.inputs.reduce(
      (ticks, input) => ticks + input[2],
      0,
    ),
  };
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(
          (_node, from) =>
            window.__audioSuspendStates.slice(from).includes("suspended"),
          beforeAudioPause,
        ),
    )
    .toBe(true);
  const pauseButtonSize = await frame.locator("#pause").evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
  }));
  checks.screenshots.paused = await snapshot(page, output, profile, "paused");
  const beforeAudioResume = await frame
    .locator("html")
    .evaluate(() => window.__audioResumeStates.length);
  await frame.locator("#start").click();
  await expect(frame.locator("#overlay")).toBeHidden();
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(
          (_node, from) =>
            window.__audioResumeStates.slice(from).includes("running"),
          beforeAudioResume,
        ),
    )
    .toBe(true);
  expect(
    await frame.locator("#pause").evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })),
  ).toEqual(pauseButtonSize);
  if (profile.width === 360) {
    await expect(frame.locator("#boost")).toBeVisible();
    const beforeButtonTicks = ticks(await checkpoint(frame));
    await frame.locator("#boost").hover();
    await page.mouse.down();
    await expect
      .poll(async () => {
        const value = await checkpoint(frame);
        return (
          ticks(value) > beforeButtonTicks && value.inputs.at(-1)?.[1] === true
        );
      })
      .toBe(true);
    await page.mouse.up();
    await expect
      .poll(async () => (await checkpoint(frame)).inputs.at(-1)?.[1])
      .toBe(false);
    checks.controls.boostButton = true;
    checks.controls.twoFingerTouch = await checkTwoFingerControls(page, frame);
  }
  await frame.locator("#board").focus();
  const beforeDiagonalTicks = ticks(await checkpoint(frame));
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("ArrowLeft");
  await expect
    .poll(async () => {
      const value = await checkpoint(frame);
      return (
        ticks(value) > beforeDiagonalTicks && value.inputs.at(-1)?.[0] === 160
      );
    })
    .toBe(true);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("ArrowUp");
  await pause(page, frame);
  await expect
    .poll(async () =>
      (await checkpoint(frame)).inputs.some(([angle]) => angle === 160),
    )
    .toBe(true);
  if (profile.width === 360)
    expect(
      (await checkpoint(frame)).inputs
        .slice(firstRun.inputs.length)
        .some(([, boosting]) => boosting === true),
    ).toBe(true);
  expect(
    (await checkpoint(frame)).inputs.some(([angle]) => angle === 160),
  ).toBe(true);
  checks.controls.keyboardDiagonal = true;
  const replay = await frame.locator("html").evaluate(async () =>
    starter.run("validate", {
      checkpoint: JSON.stringify(window.__sdkSnapshot.checkpoint),
    }),
  );
  expect(replay.description).toMatch(/Wasm/);
  await idle();
  checks.replay = {
    validatedByRealWasm: true,
    description: replay.description,
  };
  const restored = await checkpoint(frame);
  for (const [key, value] of Object.entries(checks.preferences))
    expect(restored[key], key).toBe(value);
  const audio = await frame
    .locator("html")
    .evaluate(() => window.__slitherAudioProbe);
  expect(audio.decoded.length).toBeGreaterThan(0);
  expect(audio.started.length).toBeGreaterThan(0);
  expect(audio.decoded.every((buffer) => buffer.duration > 0)).toBe(true);
  checks.audio = audio;
  checks.audio.gameplaySourcesAfterStart =
    audio.started.length - beforeStartSources;
  checks.pauseButtonSize = pauseButtonSize;
  if (profile.width === 1120)
    checks.shortArena = await checkShortArena({
      page,
      frame,
      profile,
      output,
      settled,
    });
  checks.terminal = await checkTerminalReturn({
    page,
    frame,
    profile,
    output,
    settled,
  });
  await writeFile(
    join(output, `snake-${profile.language}-${profile.width}-checks.json`),
    JSON.stringify(checks, null, 2),
  );
  return checks;
}

export async function checkSlitherReload(frame, preferences) {
  await expect(frame.locator("#game-screen")).toBeVisible();
  await expect(frame.locator("#overlay")).toBeVisible();
  const restored = await checkpoint(frame);
  expect(restored.schema).toBe(3);
  expect(restored.inputs.length).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 650));
  await expect(frame.locator("#overlay")).toBeVisible();
  expect((await checkpoint(frame)).inputs).toEqual(restored.inputs);
  for (const [key, value] of Object.entries(preferences))
    expect(restored[key], key).toBe(value);
}

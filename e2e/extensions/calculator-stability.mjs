import { expect } from "@playwright/test";
import {
  openCalculatorMode,
  pasteCalculatorExpression,
} from "./regressions.mjs";

/** Stable Windows calculator controls under angle, keypad-view and busy changes. */
export async function checkCalculatorControlStability({
  page,
  frame,
  idle,
  snapshot = async () => {},
  record = async () => {},
  recordOnly = false,
}) {
  const failures = [],
    angleCases = [],
    programmerCases = [],
    busyCases = [];
  const require = (condition, label) => {
    if (!condition) failures.push(label);
  };
  const nextPaint = () =>
    frame
      .locator("html")
      .evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
  const rect = (selector) =>
    frame
      .locator(selector)
      .evaluate((node) => node.getBoundingClientRect().toJSON());
  const sameRect = (label, actual, expected) => {
    for (const dimension of ["x", "y", "width", "height"])
      require(Math.abs(actual[dimension] - expected[dimension]) <=
        0.5, `${label}.${dimension}: ${expected[dimension]} → ${actual[dimension]}`);
  };
  const run = async (action, fields = {}) => {
    await frame
      .locator("html")
      .evaluate((_node, { action, fields }) => starter.run(action, fields), {
        action,
        fields,
      });
    await idle();
  };

  await openCalculatorMode(frame, "scientific");
  await idle();
  await nextPaint();
  const notationBaseline = await rect("#notation");
  for (let index = 0; index < 7; index++) {
    const angle = await frame.locator("#angle-cycle").textContent(),
      notation = await rect("#notation"),
      angleRect = await rect("#angle-cycle");
    sameRect(`angle ${angle}: F-E`, notation, notationBaseline);
    angleCases.push({ angle, angleRect, notation });
    if (index < 6) {
      await frame.locator("#angle-cycle").click();
      await nextPaint();
    }
  }
  require(new Set(angleCases.map(({ angle }) => angle)).size ===
    3, "angle cycle did not cover DEG, RAD and GRAD");
  await record("angle-slots", angleCases);
  await snapshot("stability-scientific-angle");

  await openCalculatorMode(frame, "programmer");
  await idle();
  await frame.locator("#full-keyboard").click();
  if ((await frame.locator("#radix").inputValue()) !== "10") {
    await frame.locator('[data-base="10"]').click();
    await idle();
  }
  for (let index = 0; index < 4; index++) {
    if ((await frame.locator("#bits").inputValue()) === "64") break;
    await frame.locator("#word-size").click();
    await idle();
  }
  await expect(frame.locator("#bits")).toHaveValue("64");
  await nextPaint();
  const programmerGeometry = () =>
    frame.locator("html").evaluate(() => {
      const rect = (selector) =>
        document.querySelector(selector).getBoundingClientRect().toJSON();
      const wrapper = document.getElementById("prog-input-area");
      // The fallback records the old implementation for a before/after report.
      const input = wrapper
        ? wrapper.getBoundingClientRect().toJSON()
        : (() => {
            const keypad = rect("#prog-keypad"),
              bits = rect("#bit-grid"),
              functions = rect("#prog-function-bar");
            return document.getElementById("bit-grid").hidden
              ? {
                  ...keypad,
                  y: functions.y,
                  top: functions.top,
                  height: keypad.bottom - functions.top,
                }
              : bits;
          })();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        result: rect("#prog-result"),
        radix: rect("#radix-values"),
        toolbar: rect(".prog-toolbar"),
        input,
        equals: rect('#prog-keypad [data-key="equals"]'),
        bitGrid: rect("#bit-grid"),
        bits: [...document.querySelectorAll("#bit-grid [data-bit]")].map(
          (button) => ({
            index: Number(button.dataset.bit),
            rect: button.getBoundingClientRect().toJSON(),
          }),
        ),
      };
    });
  const programmerBaseline = await programmerGeometry();
  for (let index = 0; index < 3; index++) {
    await frame.locator("#bit-toggle").click();
    await idle();
    await nextPaint();
    const bitView = await programmerGeometry();
    for (const part of ["result", "radix", "toolbar", "input"])
      sameRect(
        `programmer bit view ${index}: ${part}`,
        bitView[part],
        programmerBaseline[part],
      );
    require(bitView.bits.length ===
      64, "programmer bit view must contain all 64 bits");
    for (const bit of bitView.bits) {
      const label = `programmer bit ${bit.index}`;
      require(bit.rect.width > 0 && bit.rect.height > 0, `${label} is hidden`);
      require(bit.rect.left >= bitView.input.left - 0.5 &&
        bit.rect.right <= bitView.input.right + 0.5 &&
        bit.rect.top >= bitView.input.top - 0.5 &&
        bit.rect.bottom <=
          bitView.input.bottom +
            0.5, `${label} extends outside the shared input area`);
      require(bit.rect.left >= -0.5 &&
        bit.rect.right <= bitView.viewport.width + 0.5 &&
        bit.rect.top >= -0.5 &&
        bit.rect.bottom <=
          bitView.viewport.height +
            0.5, `${label} is clipped by the iframe viewport`);
    }
    await record(`programmer-bit-view-${index}`, bitView);
    if (index === 0) await snapshot("stability-programmer-bits");
    await frame.locator("#full-keyboard").click();
    await nextPaint();
    const keyboard = await programmerGeometry();
    for (const part of ["result", "radix", "toolbar", "input"])
      sameRect(
        `programmer keyboard ${index}: ${part}`,
        keyboard[part],
        programmerBaseline[part],
      );
    require(keyboard.equals.top >= -0.5 &&
      keyboard.equals.bottom <=
        keyboard.viewport.height +
          0.5, "programmer equals is clipped after returning to the full keyboard");
    programmerCases.push({ iteration: index, bitView, keyboard });
  }
  await snapshot("stability-programmer-keyboard");

  const styleSnapshot = (selectors) =>
    frame.locator("html").evaluate((_node, selectors) => {
      const styles = {};
      for (const [name, selector] of Object.entries(selectors)) {
        const node = document.querySelector(selector),
          style = getComputedStyle(node);
        let effectiveOpacity = 1;
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement)
          effectiveOpacity *= Number(getComputedStyle(ancestor).opacity);
        styles[name] = {
          color: style.color,
          backgroundColor: style.backgroundColor,
          opacity: style.opacity,
          effectiveOpacity,
          filter: style.filter,
          disabled: node.disabled,
          locked: node.dataset.locked,
        };
      }
      return styles;
    }, selectors);
  const hostStyles = () =>
    page.locator("iframe").evaluate((node) => {
      const result = [];
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        result.push({
          tag: ancestor.tagName,
          opacity: style.opacity,
          filter: style.filter,
        });
      }
      return result;
    });
  const runRequests = () =>
    page.evaluate(
      () =>
        window.__iframeProtocolRequests.filter(
          (request) => request.method === "run",
        ).length,
    );
  const savedDelay = await page.evaluate(
    () => window.__extensionUiTest.viewDelayMs,
  );
  try {
    for (const mode of ["standard", "scientific", "programmer"]) {
      await openCalculatorMode(frame, mode);
      await idle();
      await run("memory-clear");
      const programmer = mode === "programmer",
        keypad = programmer ? "#prog-keypad" : "#keypad",
        selectors = {
          digit: `${keypad} [data-key="7"]`,
          operation: `${keypad} [data-key="add"]`,
          equals: `${keypad} [data-key="equals"]`,
          memoryStore: programmer
            ? "#prog-memory-store"
            : '.memory [data-action="memory-store"]',
          ...(programmer
            ? {
                invalidDigit: '#prog-keypad [data-key="A"]',
                invalidDecimal: '#prog-keypad [data-key="decimal"]',
              }
            : {
                memoryAdd: '.memory [data-action="memory-add"]',
                memorySubtract: '.memory [data-action="memory-subtract"]',
                memoryRecall: "#recall",
                memoryClear: '.memory [data-action="memory-clear"]',
              }),
        };
      if (programmer) {
        await frame.locator('#prog-keypad [data-key="clear-all"]').click();
        await idle();
        await frame.locator('#prog-keypad [data-key="2"]').click();
        await frame.locator('#prog-keypad [data-key="add"]').click();
        await frame.locator('#prog-keypad [data-key="3"]').click();
      } else await pasteCalculatorExpression(frame, "2+3");
      await page.mouse.move(0, 0);
      await nextPaint();
      const baseline = await styleSnapshot(selectors),
        hostBaseline = await hostStyles(),
        beforeRequests = await runRequests();
      for (const [name, style] of Object.entries(baseline))
        require(style.disabled ===
          (name.startsWith("invalid") ||
            ["memoryRecall", "memoryClear"].includes(
              name,
            )), `${mode}/${name}: unexpected idle availability`);
      await page.evaluate(() => {
        window.__extensionUiTest.viewDelayMs = 2000;
      });
      await frame.locator(selectors.equals).click();
      await page.mouse.move(0, 0);
      // The controller can flush a local draft before dispatching the real action.
      // Start the timed sample after that action reaches the SDK boundary.
      await expect
        .poll(runRequests, { timeout: 20000 })
        .toBe(beforeRequests + 1);
      await expect
        .poll(() => frame.locator("main").getAttribute("aria-busy"), {
          timeout: 5000,
        })
        .toBe("true");
      await page.waitForTimeout(250);
      require((await frame.locator("main").getAttribute("aria-busy")) ===
        "true", `${mode}: delayed calculation did not remain busy for the style sample`);
      const during = await styleSnapshot(selectors),
        hostDuring = await hostStyles(),
        expression = await frame.locator("#expression").inputValue();
      for (const [name, style] of Object.entries(during)) {
        require(style.disabled ===
          true, `${mode}/${name}: control must remain disabled while busy`);
        for (const property of [
          "color",
          "backgroundColor",
          "opacity",
          "effectiveOpacity",
          "filter",
        ])
          require(style[property] ===
            baseline[name][
              property
            ], `${mode}/${name}.${property}: ${baseline[name][property]} → ${style[property]} while busy`);
      }
      require(JSON.stringify(hostDuring) ===
        JSON.stringify(
          hostBaseline,
        ), `${mode}: iframe or host ancestor opacity/filter changed while busy`);
      // Native disabled clicks and the plugin's keyboard entry point must both stay gated.
      await frame.locator("html").evaluate((_node, selectors) => {
        for (const selector of Object.values(selectors))
          document.querySelector(selector).click();
        for (const key of ["9", "+", "Enter"])
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
      }, selectors);
      await page.waitForTimeout(50);
      require((await runRequests()) ===
        beforeRequests +
          1, `${mode}: busy interactions submitted a second SDK run`);
      require((await frame.locator("#expression").inputValue()) ===
        expression, `${mode}: busy keyboard input changed the pending expression`);
      const value = {
        mode,
        baseline,
        during,
        hostBaseline,
        hostDuring,
        delayedMs: 2000,
        sampledAfterMs: 250,
        runCount: (await runRequests()) - beforeRequests,
      };
      await record(`busy-colors-${mode}`, value);
      await snapshot(`stability-${mode}-busy`);
      busyCases.push(value);
      await idle();
      await page.evaluate((delay) => {
        window.__extensionUiTest.viewDelayMs = delay;
      }, savedDelay);
    }
  } finally {
    await page.evaluate((delay) => {
      window.__extensionUiTest.viewDelayMs = delay;
    }, savedDelay);
  }
  await record("control-stability-failures", failures);
  if (!recordOnly) expect(failures).toEqual([]);
  return {
    angleCases,
    programmerCases,
    busyCases,
    failures,
    recordOnly,
    realWasm: true,
    boundaryTimingMock: true,
  };
}

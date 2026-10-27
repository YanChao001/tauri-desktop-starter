import { expect } from "@playwright/test";
import {
  openCalculatorGraphInput,
  openCalculatorMode,
  pasteCalculatorExpression,
} from "./regressions.mjs";

export async function checkCalculatorProgrammerPopups({
  page,
  frame,
  idle,
  snapshot,
  reload,
}) {
  await openCalculatorMode(frame, "programmer");
  await idle();
  const evaluations = () =>
    page.evaluate(
      () =>
        window.__extensionUiTest.lifecycle.filter(
          (event) =>
            event.event === "view-start" &&
            event.detail?.input === "programmer-evaluate",
        ).length,
    );
  const beforeEvaluations = await evaluations();
  await frame.locator("#shift-menu").click();
  await expect(frame.locator("#shift-popup")).toHaveAttribute("role", "group");
  await expect(frame.locator("#shift-popup")).toHaveAttribute(
    "aria-labelledby",
    "shift-menu",
  );
  await expect(frame.locator('[data-shift="arithmetic"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await snapshot("review-programmer-shift-popup");
  await frame.locator('[data-shift="arithmetic"]').focus();
  await frame.locator('[data-shift="arithmetic"]').press("Tab");
  await expect(frame.locator('[data-shift="logical"]')).toBeFocused();
  await frame.locator('[data-shift="logical"]').press("Enter");
  await expect(frame.locator("#shift-popup")).toBeHidden();
  await frame.locator("#shift-menu").click();
  await expect(frame.locator('[data-shift="logical"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(frame.locator('[data-shift="arithmetic"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await frame.locator('[data-shift="logical"]').focus();
  await frame.locator('[data-shift="logical"]').press("Tab");
  await expect(frame.locator('[data-shift="rotate"]')).toBeFocused();
  await frame.locator('[data-shift="rotate"]').press("Space");
  await expect(frame.locator("#shift-popup")).toBeHidden();
  await frame.locator("#shift-menu").click();
  await expect(frame.locator('[data-shift="rotate"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(frame.locator('#shift-popup [aria-pressed="true"]')).toHaveCount(
    1,
  );
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.calculator?.shiftKind),
    )
    .toBe("rotate");
  await frame.locator('[data-shift="rotate"]').press("Escape");
  await reload();
  await expect(frame.locator("main")).toHaveAttribute(
    "data-mode",
    "programmer",
  );
  await frame.locator("#shift-menu").click();
  await expect(frame.locator('[data-shift="rotate"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(frame.locator('#shift-popup [aria-pressed="true"]')).toHaveCount(
    1,
  );
  await frame.locator('[data-shift="arithmetic"]').click();
  await frame.locator("#bitwise-menu").click();
  await snapshot("review-programmer-bitwise-popup");
  await frame.locator('[data-prog-op="and"]').focus();
  await frame.locator('[data-prog-op="and"]').press("Tab");
  await expect(frame.locator('[data-prog-op="or"]')).toBeFocused();
  await frame.locator('[data-prog-op="or"]').press("Enter");
  await expect(frame.locator("#bitwise-popup")).toBeHidden();
  await expect(frame.locator("#expression")).toHaveValue(/OR\s*$/);
  expect(await evaluations()).toBe(beforeEvaluations);
  return {
    shiftGroup: true,
    singlePressedOption: true,
    tabEnterSelectsLogical: true,
    tabSpaceSelectsRotate: true,
    rotateRestoredAfterReload: true,
    bitwiseTabEnterInsertsOr: true,
    spuriousEvaluations: 0,
    nativeIpc: false,
  };
}

/** Concrete calculation and clipboard regressions from the calculator audit. */
export async function checkCalculatorReview({
  page,
  frame,
  idle,
  snapshot,
  record,
  graphOnly = false,
}) {
  const key = (name, programmer = false) =>
    frame.locator(
      `${programmer ? "#prog-keypad" : "#keypad"} [data-key="${name}"]`,
    );
  async function keys(sequence, programmer = false) {
    for (const name of sequence) {
      await key(name, programmer).click();
      await idle();
    }
  }
  const copy = (selector) =>
    frame.locator(selector).evaluate((node) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "editor-copy-sentinel");
      const event = new ClipboardEvent("copy", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        text: clipboardData.getData("text/plain"),
      };
    });

  let squareRoot, standardCopy, scientificCopy, programmerCopy;
  if (!graphOnly) {
    await openCalculatorMode(frame, "standard");
    await keys(["clear-all", "2", "add", "3", "multiply", "4", "equals"]);
    await expect(frame.locator("#result")).toHaveText("20");
    await keys(["sqrt"]);
    squareRoot = Number(await frame.locator("#result").textContent());
    expect(squareRoot).toBeCloseTo(Math.sqrt(20), 12);
    await keys(["clear-all", "2", "add", "3", "multiply", "4", "equals"]);
    await keys(["add", "5", "equals"]);
    await expect(frame.locator("#result")).toHaveText("25");
    standardCopy = await copy("#result");
    expect(standardCopy).toEqual({ prevented: true, text: "25" });
    await snapshot("review-standard-compound");

    await openCalculatorMode(frame, "scientific");
    await pasteCalculatorExpression(frame, "root(27,3)");
    await frame.locator("body").press("Enter");
    await idle();
    await expect(frame.locator("#result")).toHaveText("3");
    scientificCopy = await copy("#result");
    expect(scientificCopy).toEqual({ prevented: true, text: "3" });

    await openCalculatorMode(frame, "programmer");
    await keys(["clear-all", "5", "add"], true);
    await pasteCalculatorExpression(frame, "3");
    await keys(["multiply", "2", "equals"], true);
    await expect(frame.locator("#prog-result")).toHaveText("6");
    programmerCopy = await copy("#prog-result");
    expect(programmerCopy).toEqual({ prevented: true, text: "6" });
    await snapshot("review-programmer-paste");
  }

  await openCalculatorGraphInput(frame);
  const equation = frame.locator('#equations input[data-equation="0"]');
  await equation.fill("sin(x)+1");
  await equation.evaluate((node) => {
    node.focus();
    node.setSelectionRange(0, 3);
  });
  const editorCopy = await copy('#equations input[data-equation="0"]');
  expect(editorCopy).toEqual({
    prevented: false,
    text: "editor-copy-sentinel",
  });
  const editorSelection = await equation.evaluate((node) =>
    node.value.slice(node.selectionStart, node.selectionEnd),
  );
  expect(editorSelection).toBe("sin");
  await frame
    .locator("html")
    .evaluate(() => window.getSelection().removeAllRanges());

  const evaluateCount = () =>
    page.evaluate(
      () =>
        window.__extensionUiTest.lifecycle.filter(
          (event) =>
            event.event === "view-start" && event.detail?.input === "evaluate",
        ).length,
    );
  const beforeGraphEvaluate = await evaluateCount(),
    beforeGraphExpression = await frame.locator("#expression").inputValue();
  await equation.fill("x");
  await equation.evaluate((node) => {
    node.focus();
    node.select();
    window.__reviewEquationNode = node;
  });
  const selection = () =>
    equation.evaluate((node) => ({
      value: node.value,
      start: node.selectionStart,
      end: node.selectionEnd,
      sameNode: node === window.__reviewEquationNode,
      originalConnected: window.__reviewEquationNode?.isConnected,
      active: document.activeElement.id || document.activeElement.tagName,
    }));
  const beforeMenu = await selection();
  await frame.locator("#trig-menu").click();
  // Keep the menu open through the field acknowledgement that can rebuild an unfocused input.
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.fields.functions),
    )
    .toBe("x");
  await frame
    .locator("html")
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const afterMenu = await selection();
  await frame.locator('[data-trig="sin"]').click();
  const afterFunction = await selection();
  await record("graph-selection", { beforeMenu, afterMenu, afterFunction });
  await expect(equation).toHaveValue("sin(x)");
  await expect(frame.locator("#functions")).toHaveValue("sin(x)");
  await equation.evaluate((node) => {
    node.focus();
    node.select();
  });
  await frame.locator("#functions-menu").click();
  await frame.locator('[data-function="floor"]').click();
  await expect(equation).toHaveValue("floor(sin(x))");
  await expect(frame.locator("#functions")).toHaveValue("floor(sin(x))");
  await expect(frame.locator("#expression")).toHaveValue(beforeGraphExpression);
  expect(await evaluateCount()).toBe(beforeGraphEvaluate);
  await snapshot("review-graph-function-insertion");

  await openCalculatorMode(frame, "date");
  await expect
    .poll(
      () =>
        frame.locator("html").evaluate(() => {
          const state = JSON.parse(window.__sdkSnapshot.view.state);
          return state.fields.mode === "date" && state.date != null;
        }),
      { timeout: 60000 },
    )
    .toBe(true);
  await idle();
  await frame.locator("#date-from-button").click();
  await frame.locator("#calendar-year").selectOption("2024");
  await frame.locator("#calendar-month").selectOption("2");
  const focusableDay = frame.locator(
    '#calendar-grid [data-date][tabindex="0"]:not(:disabled)',
  );
  await expect(focusableDay).toHaveCount(1);
  await frame.locator("#calendar-next").focus();
  await frame.locator("#calendar-next").press("Tab");
  await expect(focusableDay).toBeFocused();
  await focusableDay.press("ArrowRight");
  const keyboardDate = await frame
    .locator("html")
    .evaluate(() => document.activeElement.dataset.date);
  expect(keyboardDate).toMatch(/^2024-02-\d{2}$/);
  await snapshot("review-calendar-keyboard");
  await frame
    .locator(`#calendar-grid [data-date="${keyboardDate}"]`)
    .press("Enter");
  await expect(frame.locator("#date-from")).toHaveValue(keyboardDate);
  await expect(frame.locator("#calendar-popup")).toBeHidden();
  await expect
    .poll(
      () =>
        frame.locator("html").evaluate(() => {
          const state = JSON.parse(window.__sdkSnapshot.view.state);
          return (
            state.fields.dateFrom === document.getElementById("date-from").value
          );
        }),
      { timeout: 60000 },
    )
    .toBe(true);
  await idle();

  await openCalculatorMode(frame, "standard");
  await pasteCalculatorExpression(frame, "42");
  await frame.locator("#navigation").click();
  await frame.locator("#settings-open").click();
  await expect(frame.locator("#settings-dialog")).toBeVisible();
  const expressionBefore = await frame.locator("#expression").inputValue();
  const settingsPaste = await frame
    .locator("#settings-dialog")
    .evaluate((node) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "999");
      const event = new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    });
  expect(settingsPaste.prevented).toBe(false);
  await expect(frame.locator("#expression")).toHaveValue(expressionBefore);
  await frame.locator("#settings-close").click();
  await keys(["clear-all"]);
  const result = {
    standardCompoundResult: graphOnly
      ? undefined
      : { squareRoot, continuedAddition: 25 },
    scientificArgumentCommaRetained: !graphOnly,
    programmerPasteResetsPendingOperand: !graphOnly,
    standardCopy,
    scientificCopy,
    programmerCopy,
    editorCopy,
    editorSelection,
    graphFlyout: {
      equation: "floor(sin(x))",
      evaluateRequests: 0,
      hiddenExpressionUnchanged: true,
    },
    calendarKeyboardDate: keyboardDate,
    settingsPaste,
    realWasm: true,
    clipboardBoundary:
      "Synthetic ClipboardEvent/DataTransfer verifies document routing; no OS clipboard access",
  };
  await record("calculation-clipboard", result);
  return result;
}

/** Without HTTPS permission, typing currency values must remain quiet and offline. */
export async function checkCalculatorOfflineCurrency({
  page,
  frame,
  idle,
  snapshot,
  currencyCalls,
}) {
  const refreshes = () =>
    page.evaluate(
      () =>
        window.__extensionUiTest.lifecycle.filter(
          (event) =>
            event.event === "view-start" &&
            event.detail?.input === "currency-refresh",
        ).length,
    );
  const beforeHttp = currencyCalls().length;
  const permissions = await frame
    .locator("html")
    .evaluate(() => window.__sdkSnapshot.grantedPermissions);
  expect(permissions).not.toContain("network:https");
  await frame.locator("#navigation").click();
  await frame.locator('[data-converter-category="currency"]').click();
  await expect
    .poll(
      () =>
        frame
          .locator("html")
          .evaluate(
            () =>
              JSON.parse(window.__sdkSnapshot.view.state).converter?.category,
          ),
      { timeout: 60000 },
    )
    .toBe("currency");
  for (const value of ["12", "125"]) {
    await frame.locator("main").evaluate((node, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", value);
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, value);
    await expect
      .poll(
        () =>
          frame
            .locator("html")
            .evaluate(
              () =>
                JSON.parse(window.__sdkSnapshot.view.state).converter?.input,
            ),
        { timeout: 60000 },
      )
      .toBe(value);
    await idle();
  }
  // Both real conversion receipts have completed, so their automatic-refresh branches ran.
  expect(await refreshes()).toBe(0);
  expect(currencyCalls().length).toBe(beforeHttp);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect(frame.locator("#currency-refresh")).toBeEnabled();
  await frame.locator("#currency-refresh").click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    /network|permission|网络|权限/i,
  );
  await idle();
  const manualRefreshes = await refreshes();
  expect(manualRefreshes).toBeLessThanOrEqual(1);
  expect(currencyCalls().length).toBe(beforeHttp);
  await snapshot("review-currency-no-permission");
  return {
    permissions,
    automaticRefreshes: 0,
    manualRefreshes,
    httpRequests: currencyCalls().length - beforeHttp,
    typingDoesNotNotify: true,
    manualRefreshShowsPermissionFeedback: true,
    realWasm: true,
    nativePermissions: false,
  };
}

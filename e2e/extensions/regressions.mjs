import { expect } from "@playwright/test";

export async function pasteCalculatorExpression(frame, value) {
  await pasteCalculatorValue(frame, value, "expression");
}

async function pasteCalculatorValue(frame, value, id) {
  await frame.locator("main").evaluate((node, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, value);
  await expect(frame.locator("#" + id)).toHaveValue(value);
}

export async function openCalculatorMode(frame, mode) {
  if ((await frame.locator("main").getAttribute("data-mode")) !== mode) {
    await frame.locator("#navigation").click();
    await frame.locator(`#${mode}-mode`).click();
  }
  await expect(frame.locator("main")).toHaveAttribute("data-mode", mode);
  await expect(frame.locator("#mode")).toHaveValue(mode);
}

export async function openCalculatorGraph(frame) {
  await openCalculatorMode(frame, "graph");
  if (await frame.locator("#graph-view").isVisible())
    await frame.locator("#graph-view").click();
  await expect(frame.locator("#graph-panel")).toBeVisible();
}

export async function openCalculatorGraphInput(frame) {
  await openCalculatorMode(frame, "graph");
  if (await frame.locator("#graph-input").isVisible())
    await frame.locator("#graph-input").click();
  await expect(frame.locator("#equations")).toBeVisible();
}

export async function setCalculatorFunctions(frame, expressions) {
  await openCalculatorGraphInput(frame);
  const inputs = frame.locator("#equations input[data-equation]");
  for (const [index, expression] of expressions.entries()) {
    if ((await inputs.count()) <= index)
      await frame.locator("#add-equation").click();
    await inputs.nth(index).fill(expression);
  }
  for (let index = expressions.length; index < (await inputs.count()); index++)
    await inputs.nth(index).fill("");
  await expect(frame.locator("#functions")).toHaveValue(expressions.join("\n"));
}

export async function setCalculatorRange(frame, values) {
  await openCalculatorGraph(frame);
  if (!(await frame.locator("#graph-settings").isVisible()))
    await frame.locator("#graph-settings-toggle").click();
  for (const [id, value] of Object.entries(values))
    await frame.locator("#" + id).fill(value);
}

export async function closeCalculatorRange(frame) {
  if (await frame.locator("#graph-settings").isVisible())
    await frame.locator("#graph-settings-close").click();
}

export async function openCalculatorAnalysis(frame) {
  await openCalculatorGraphInput(frame);
  if (!(await frame.locator("#analysis-panel").isVisible()))
    await frame.locator("#analysis-toggle").click();
}

export async function openCalculatorHistory(frame) {
  if (
    !["standard", "scientific"].includes(
      await frame.locator("main").getAttribute("data-mode"),
    )
  )
    await openCalculatorMode(frame, "scientific");
  if (!(await frame.locator("#history-panel").isVisible()))
    await frame.locator("#history-toggle").click();
  await frame.locator("#history-tab").click();
  await expect(frame.locator("#history-content")).toBeVisible();
}

export async function openCalculatorWorkspace(frame) {
  await frame.locator("#navigation").click();
  await frame.locator("#settings-open").click();
  const details = frame.locator(
    '#settings-dialog details:has([data-i18n="workspace"])',
  );
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
  await expect(frame.locator('[data-action="export"]')).toBeVisible();
}

/** Long history and memory lists must scroll without resizing either calculator keypad. */
export async function checkCalculatorHistoryLayout({
  page,
  frame,
  idle,
  snapshot,
  record,
  recordOnly = false,
}) {
  const cases = [],
    failures = [];
  const geometry = () =>
    frame.locator("html").evaluate(() => {
      const rect = (selector) =>
        document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        workspace: rect(".workspace"),
        calculator: rect(".calculator"),
        keypad: rect("#keypad"),
        equals: rect('#keypad [data-key="equals"]'),
        panel: rect("#history-panel"),
        footer: rect(".rail-footer"),
        documentHeight: document.documentElement.scrollHeight,
      };
    });
  const require = (condition, label) => {
    if (!condition) failures.push(label);
  };
  async function run(action, fields = {}) {
    await frame
      .locator("html")
      .evaluate((_node, { action, fields }) => starter.run(action, fields), {
        action,
        fields,
      });
    await idle();
  }
  async function measure(mode, name, baseline) {
    const value = await geometry();
    const label = `${mode}/${name}`;
    require(value.equals.top >= -1, `${label}: equals starts above iframe`);
    require(value.equals.bottom <=
      value.viewport.height +
        1, `${label}: equals extends below iframe (${value.equals.bottom} > ${value.viewport.height})`);
    require(value.keypad.bottom <=
      value.viewport.height + 1, `${label}: keypad extends below iframe`);
    for (const part of ["keypad", "equals"])
      for (const dimension of ["top", "height", "bottom"])
        require(Math.abs(value[part][dimension] - baseline[part][dimension]) <=
          1, `${label}: ${part}.${dimension} changed from ${baseline[part][dimension]} to ${value[part][dimension]}`);
    if (await frame.locator("#history-panel").isVisible()) {
      require(value.panel.top >= -1, `${label}: panel starts above iframe`);
      require(value.panel.bottom <=
        value.viewport.height + 1, `${label}: panel extends below iframe`);
      require(value.footer.bottom <=
        value.viewport.height + 1, `${label}: footer extends below iframe`);
    }
    await record(`${mode}-${name}`, value);
    await snapshot(`history-layout-${mode}-${name}`);
    return value;
  }
  async function scrollList(mode, name, selector) {
    const value = await frame.locator(selector).evaluate(async (node) => {
      const first = node.querySelector("li:first-child"),
        last = node.querySelector("li:last-child"),
        nextPaint = () =>
          new Promise((resolve) => requestAnimationFrame(resolve));
      node.scrollTop = 0;
      await nextPaint();
      const firstRect = first.getBoundingClientRect().toJSON(),
        pane = node.getBoundingClientRect().toJSON();
      node.scrollTop = node.scrollHeight;
      await nextPaint();
      return {
        pane,
        first: firstRect,
        last: last.getBoundingClientRect().toJSON(),
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        viewportHeight: innerHeight,
      };
    });
    const label = `${mode}/${name}`;
    require(value.scrollTop >
      0, `${label}: long list cannot scroll internally`);
    require(value.first.top >= value.pane.top - 1 &&
      value.first.bottom <=
        value.pane.bottom +
          1, `${label}: first item is not visible at scroll start`);
    require(value.last.top >= value.pane.top - 1 &&
      value.last.bottom <= value.pane.bottom + 1 &&
      value.last.bottom <=
        value.viewportHeight +
          1, `${label}: last item is not visible at scroll end`);
    await record(`${mode}-${name}-scroll`, value);
    await frame.locator(selector).evaluate((node) => (node.scrollTop = 0));
    return value;
  }
  for (const mode of ["standard", "scientific"]) {
    await openCalculatorMode(frame, mode);
    await run("evaluate", { mode, expression: "0", operator: "layout-empty" });
    const baseline = await geometry();
    await run("evaluate", { mode, operator: "layout-history" });
    await openCalculatorHistory(frame);
    await expect(frame.locator("#history > li")).toHaveCount(32);
    const history = await measure(mode, "history-full", baseline),
      historyScroll = await scrollList(
        mode,
        "history-full",
        "#history-content",
      );
    await frame.locator("#memory-tab").click();
    await expect(frame.locator("#memory-empty")).toBeVisible();
    const emptyMemory = await measure(mode, "memory-empty", baseline);
    await frame.locator("#history-tab").click();
    await measure(mode, "history-return", baseline);
    await run("evaluate", { mode, operator: "layout-memory" });
    await frame.locator("#memory-tab").click();
    await expect(frame.locator("#memory-list > li")).toHaveCount(16);
    const fullMemory = await measure(mode, "memory-full", baseline),
      memoryScroll = await scrollList(mode, "memory-full", "#memory-content");
    await frame.locator("#history-tab").click();
    const finalHistory = await measure(mode, "history-after-memory", baseline);
    const clear = frame.locator("#clear-rail");
    if (finalHistory.footer.bottom <= finalHistory.viewport.height + 1) {
      await expect(clear).toBeVisible();
      await expect(clear).toBeEnabled();
      await clear.click();
      await idle();
      await expect(frame.locator("#history > li")).toHaveCount(0);
      await expect(frame.locator("#history-empty")).toBeVisible();
      await measure(mode, "history-cleared", baseline);
    } else require(false, `${mode}: history clear action is outside iframe`);
    if (page.viewportSize().width <= 720) {
      await frame.locator("#rail-close").click();
      await expect(frame.locator("#history-panel")).toBeHidden();
      await measure(mode, "overlay-closed", baseline);
    }
    cases.push({
      mode,
      baseline,
      history,
      emptyMemory,
      fullMemory,
      historyScroll,
      memoryScroll,
    });
  }
  if (!recordOnly) expect(failures).toEqual([]);
  return {
    cases,
    failures,
    recordOnly,
    historyEntries: 32,
    memoryEntries: 16,
    realWasm: true,
    stateFixture:
      "32 history and 16 memory items injected at the browser boundary, then validated/rendered by real Wasm",
    scope:
      "Real SDK/Wasm rendering and history clear; fixture lists, browser geometry and inner scrolling, no native OS window validation",
  };
}

/** 标准模式按 Windows 连续运算、百分比和 CE 的公开行为验收。 */
export async function checkCalculatorStandardKeys({
  page,
  frame,
  idle,
  snapshot,
}) {
  await expect(frame.locator("main")).toHaveAttribute("data-mode", "standard");
  const columns = await frame
    .locator("#keypad")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" "));
  expect(columns).toHaveLength(4);
  async function keys(sequence) {
    for (const name of sequence) {
      await frame.locator(`#keypad button[data-key="${name}"]`).click();
      await idle();
    }
  }
  await keys(["clear-all", "2", "add", "3", "multiply", "4", "equals"]);
  await expect(frame.locator("#result")).toHaveText("20", { timeout: 60000 });
  await keys([
    "clear-all",
    "2",
    "0",
    "0",
    "add",
    "1",
    "0",
    "percent",
    "equals",
  ]);
  await expect(frame.locator("#result")).toHaveText("220", { timeout: 60000 });
  await keys([
    "clear-all",
    "1",
    "2",
    "add",
    "3",
    "4",
    "clear-entry",
    "5",
    "equals",
  ]);
  await expect(frame.locator("#result")).toHaveText("17", { timeout: 60000 });
  await expect(frame.locator("#always-on-top")).toBeDisabled();
  await snapshot("standard");
  if (page.viewportSize().width === 420) {
    await frame.locator("#navigation").click();
    await frame.locator("#standard-mode").scrollIntoViewIfNeeded();
    await snapshot("navigation");
    await frame.locator("#navigation-close").click();
  }
  return {
    columns: columns.length,
    sequentialArithmetic: true,
    percent: true,
    clearEntryRetainsLeftOperand: true,
    alwaysOnTop: "unsupported browser boundary",
    realWasm: true,
  };
}

export async function checkCalculatorProgrammer({ frame, idle, snapshot }) {
  await openCalculatorMode(frame, "programmer");
  async function selectedRadixMatchesResult() {
    const value = await frame
      .locator('#radix-values button[aria-pressed="true"] span:last-child')
      .textContent();
    await expect(frame.locator("#prog-result")).toHaveText(value);
  }
  for (const name of ["clear-all", "2", "5", "5", "equals"]) {
    await frame.locator(`#prog-keypad button[data-key="${name}"]`).click();
    await idle();
  }
  await expect(frame.locator("#prog-result")).toHaveText("255", {
    timeout: 60000,
  });
  await expect(frame.locator("#base-16")).toHaveText("FF");
  await expect(frame.locator("#base-2")).toHaveText("11111111");
  await frame.locator('#radix-values button[data-base="16"]').click();
  await expect(frame.locator("#prog-result")).toHaveText("FF", {
    timeout: 60000,
  });
  await idle();
  await expect(
    frame.locator('#prog-keypad button[data-key="A" i]'),
  ).toBeEnabled();
  await frame.locator("#bit-toggle").click();
  await frame.locator('#bit-grid button[data-bit="0"]').click();
  await expect(frame.locator("#prog-result")).toHaveText("FE", {
    timeout: 60000,
  });
  await idle();
  await expect(frame.locator("#base-10")).toHaveText("254");
  await expect(frame.locator('#bit-grid button[data-bit="0"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  for (
    let step = 0;
    step < 4 && (await frame.locator("#bits").inputValue()) !== "8";
    step++
  ) {
    await frame.locator("#word-size").click();
    await idle();
  }
  await expect(frame.locator("#bits")).toHaveValue("8");
  await expect(frame.locator('#bit-grid button[data-bit="7"]')).toBeEnabled();
  const outsideByte = frame.locator('#bit-grid button[data-bit="8"]');
  if (await outsideByte.count()) await expect(outsideByte).toBeDisabled();
  await expect(frame.locator("#base-10")).toHaveText("-2");
  await selectedRadixMatchesResult();
  await frame.locator("#full-keyboard").click();
  await frame.locator('#radix-values button[data-base="10"]').click();
  await expect(frame.locator("#prog-result")).toHaveText("-2", {
    timeout: 60000,
  });
  await idle();
  for (const [sequence, result] of [
    [["clear-all", "5", "add", "3", "sign", "equals"], "2"],
    [["clear-all", "1", "lsh", "3", "equals"], "8"],
  ]) {
    for (const name of sequence) {
      await frame.locator(`#prog-keypad button[data-key="${name}"]`).click();
      await idle();
    }
    await expect(frame.locator("#prog-result")).toHaveText(result, {
      timeout: 60000,
    });
    await selectedRadixMatchesResult();
  }
  await snapshot("programmer");
  return {
    decimalHexBinary: true,
    bitToggle: true,
    byteSignedWord: true,
    negativeRadixConversion: true,
    pendingUnaryOperand: true,
    binaryShift: true,
    selectedRadixDisplayConsistent: true,
    realWasm: true,
  };
}

export async function checkCalculatorDates({ page, frame, idle, snapshot }) {
  await openCalculatorMode(frame, "date");
  async function compute(edit) {
    const before = await page.evaluate(
      () => window.__extensionUiTest.lifecycle.length,
    );
    await edit();
    // 日期自动计算先去抖再启动；等待实际 Wasm 回执，不能把计时器尚未启动当成空闲。
    await expect
      .poll(
        () =>
          page.evaluate((before) => {
            const events = window.__extensionUiTest.lifecycle.slice(before);
            const started = events.findIndex(
              (event) =>
                event.event === "view-start" &&
                ["date-difference", "date-offset"].includes(
                  event.detail?.input,
                ),
            );
            return (
              started >= 0 &&
              events
                .slice(started + 1)
                .some((event) => event.event === "view-end")
            );
          }, before),
        { timeout: 60000 },
      )
      .toBe(true);
    await idle();
  }
  async function date(id, value) {
    const [year, month] = value.split("-");
    await frame.locator(`#date-${id}-button`).click();
    await frame.locator("#calendar-year").selectOption(year);
    await frame.locator("#calendar-month").selectOption(String(Number(month)));
    if (id === "from" && value === "2024-02-01")
      await snapshot("date-calendar");
    await compute(() =>
      frame.locator(`#calendar-grid button[data-date="${value}"]`).click(),
    );
    await expect(frame.locator(`#date-${id}`)).toHaveValue(value);
  }
  await compute(() =>
    frame.locator("#date-operation").selectOption("difference"),
  );
  await date("from", "2024-02-01");
  await date("to", "2024-03-01");
  await expect(frame.locator("#date-total")).toContainText("29", {
    timeout: 60000,
  });
  await snapshot("date-difference");
  await compute(() => frame.locator("#date-operation").selectOption("add"));
  await date("from", "2024-01-31");
  await frame.locator("#date-months").fill("1");
  await expect
    .poll(
      () =>
        frame
          .locator("html")
          .evaluate(
            () => JSON.parse(window.__sdkSnapshot.view.state).date?.date,
          ),
      { timeout: 60000 },
    )
    .toBe("2024-02-29");
  await expect(frame.locator("#date-result")).toContainText("2024");
  await idle();
  await snapshot("date-offset");
  return {
    leapYearDifferenceDays: 29,
    monthEndOffset: "2024-02-29",
    customCalendar: true,
    realWasm: true,
  };
}

/** 全部转换入口由真实键盘/选择框驱动；货币仅替换 HTTP 边界，换算仍由打包 Wasm 执行。 */
export async function checkCalculatorConverters({
  page,
  frame,
  idle,
  snapshot,
  currency,
  layoutOnly = false,
  layoutCategories = ["currency", "data"],
  navigationOnly = false,
}) {
  layoutOnly ||= navigationOnly;
  const allCases = [
    ["currency", "USD", "CNY", "12.5", 90],
    ["volume", "74", "75", "2", 2000],
    ["length", "34", "30", "1", 100],
    ["weight", "88", "86", "1", 1000],
    ["temperature", "46", "47", "100", 212],
    ["energy", "29", "27", "1", 1000],
    ["area", "7", "3", "1", 10000],
    ["speed", "62", "57", "1", 100],
    ["time", "50", "53", "1", 60],
    ["power", "44", "45", "1", 1000],
    ["data", "150", "12", "1", 1024],
    ["pressure", "137", "141", "1", 101325],
    ["angle", "134", "136", "180", 200],
  ];
  expect(
    layoutCategories.every((category) =>
      allCases.some(([name]) => name === category),
    ),
  ).toBe(true);
  const narrow = page.viewportSize().width < 800;
  const cases = navigationOnly
    ? []
    : layoutOnly
      ? allCases.filter(([category]) => layoutCategories.includes(category))
      : narrow
        ? allCases.filter(([category]) =>
            ["currency", "length", "temperature", "data"].includes(category),
          )
        : allCases;
  for (const [category] of allCases)
    await expect(
      frame.locator(`[data-converter-category="${category}"]`),
    ).toHaveCount(1);
  const results = [];
  const number = (text) =>
    Number(text.replaceAll(/[,\s]/g, "").replaceAll("−", "-"));
  const state = () =>
    frame
      .locator("html")
      .evaluate(() => JSON.parse(window.__sdkSnapshot.view.state));
  async function open(category) {
    await frame.locator("#navigation").click();
    await frame.locator(`[data-converter-category="${category}"]`).click();
    await expect(frame.locator("main")).toHaveAttribute(
      "data-mode",
      "converter",
    );
    await expect(frame.locator("#mode")).toHaveValue("converter");
    await expect(frame.locator("#converterCategory")).toHaveValue(category);
    await expect
      .poll(async () => (await state()).converter?.category, { timeout: 60000 })
      .toBe(category);
    await idle();
  }
  async function converted(category, from, to, input, expected, side = "to") {
    await expect
      .poll(
        async () => {
          const data = (await state()).converter;
          return (
            data?.category === category &&
            data.from === from &&
            data.to === to &&
            data.input === input &&
            data.result != null
          );
        },
        { timeout: 60000 },
      )
      .toBe(true);
    await idle();
    await expect
      .poll(
        async () =>
          number(
            await frame.locator("#converter-output-" + side).textContent(),
          ),
        { timeout: 60000 },
      )
      .toBeCloseTo(expected, 6);
  }
  const currencyStart = currency.calls().length;
  for (const [category, from, to, input, expected] of cases) {
    await open(category);
    for (const [side, value] of [
      ["from", from],
      ["to", to],
    ]) {
      await expect(
        frame.locator(`#converter-${side} option[value="${value}"]`),
      ).toBeAttached({ timeout: 60000 });
      await frame.locator("#converter-" + side).selectOption(value);
    }
    await pasteCalculatorValue(frame, input, "converterInput");
    await converted(category, from, to, input, expected);
    await snapshot("converter-" + category);
    results.push({ category, from, to, input, expected, realWasm: true });
    if (category === "currency") {
      if (layoutOnly)
        await expect(frame.locator("#currency-date")).toHaveAttribute(
          "data-stale",
          "true",
        );
      await expect(frame.locator("#currency-source")).toBeVisible();
      await expect(frame.locator("#currency-source")).toHaveAttribute(
        "href",
        "https://www.exchangerate-api.com",
      );
      expect(currency.calls().length).toBe(currencyStart + 1);
      if (layoutOnly) continue;
      const cache = JSON.stringify((await state()).currency);
      const beforeFailure = currency.calls().length;
      currency.failNext();
      await frame.locator("#currency-refresh").click();
      await expect
        .poll(() => currency.calls().length, { timeout: 60000 })
        .toBe(beforeFailure + 1);
      await idle();
      expect(JSON.stringify((await state()).currency)).toBe(cache);
      expect((await state()).notice).toMatch(
        /cached rates were retained|缓存已保留/,
      );
      await converted(category, from, to, input, expected);
      await frame.locator("#currency-refresh").click();
      await expect
        .poll(() => currency.calls().length, { timeout: 60000 })
        .toBe(beforeFailure + 2);
      await idle();
      await converted(category, from, to, input, expected);
    }
  }
  if (!layoutOnly) {
    await open("length");
    await frame.locator("#converter-value-to").click();
    await pasteCalculatorValue(frame, "500", "converterInput");
    await converted("length", "30", "34", "500", 5, "from");
    await expect(frame.locator("#converter-value-to")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await snapshot("converter-length-reverse");
    await open("temperature");
    await pasteCalculatorValue(frame, "40", "converterInput");
    await converted("temperature", "46", "47", "40", 104);
    await frame
      .locator('#converter-keypad [data-converter-key="negate"]')
      .click();
    await converted("temperature", "46", "47", "-40", -40);
    await snapshot("converter-temperature-negative");
  }
  if (narrow && !navigationOnly) {
    await open("data");
    await pasteCalculatorValue(frame, "1234567890123456", "converterInput");
    await expect
      .poll(async () => (await state()).converter?.result, { timeout: 60000 })
      .toBe("1264197519486418944");
    await idle();
    await frame.locator('#converter-keypad [data-converter-key="7"]').click();
    await expect(frame.locator("#converterInput")).toHaveValue(
      "1234567890123456",
    );
    await snapshot("converter-data-long");
  }
  let converterNavigation;
  if (page.viewportSize().width === 420) {
    await frame.locator("#navigation").click();
    converterNavigation = await frame
      .locator(".drawer-scroll")
      .evaluate((node) => {
        const caption = node.querySelector('[data-i18n="converters"]');
        const captionText = document.createRange();
        captionText.selectNodeContents(caption);
        node.scrollTop +=
          captionText.getBoundingClientRect().top -
          node.getBoundingClientRect().top;
        const bounds = node.getBoundingClientRect();
        const footer = document
          .querySelector(".drawer-footer")
          .getBoundingClientRect();
        return {
          viewport: { top: bounds.top, bottom: bounds.bottom },
          captionTop: caption.getBoundingClientRect().top,
          captionTextTop: captionText.getBoundingClientRect().top,
          footer: { top: footer.top, bottom: footer.bottom },
          options: [...node.querySelectorAll("[data-converter-category]")].map(
            (button) => {
              const rect = button.getBoundingClientRect();
              return {
                category: button.dataset.converterCategory,
                top: rect.top,
                bottom: rect.bottom,
                fullyVisible:
                  rect.top >= bounds.top - 1 &&
                  rect.bottom <= bounds.bottom + 1,
              };
            },
          ),
        };
      });
    await snapshot("converters-navigation");
    expect(converterNavigation.options).toHaveLength(13);
    expect(
      converterNavigation.options.every((option) => option.fullyVisible),
    ).toBe(true);
    expect(converterNavigation.footer.bottom).toBeLessThanOrEqual(
      await frame.locator("html").evaluate(() => innerHeight + 1),
    );
    await expect(
      frame.locator('[data-converter-category="angle"]'),
    ).toBeInViewport();
    await expect(frame.locator(".drawer-footer")).toBeInViewport();
    await frame.locator("#navigation-close").click();
  }
  await openCalculatorMode(frame, "standard");
  return {
    cases: results,
    categoryCount: results.length,
    all13NavigationEntries: true,
    longInputLayout: narrow && !navigationOnly,
    reverseInput: !layoutOnly,
    negativeTemperature: !layoutOnly,
    currencyFailureRetainsCache: !layoutOnly,
    currencyManualRetry: !layoutOnly,
    converterNavigation,
    layoutOnly,
    navigationOnly,
    currencyRates:
      "Invented offline HTTP boundary fixture; no live rates verified",
    actualCurrencyReceipts: currency.calls().slice(currencyStart),
  };
}

export async function checkCalculatorModeLayouts({
  page,
  frame,
  idle,
  snapshot,
  freshGraph = false,
}) {
  for (const mode of [
    "standard",
    "scientific",
    "programmer",
    "date",
    "graph",
  ]) {
    const before = await page.evaluate(
      () => window.__extensionUiTest.lifecycle.length,
    );
    if (mode === "graph") await openCalculatorGraph(frame);
    else await openCalculatorMode(frame, mode);
    if (mode === "date") {
      await expect
        .poll(
          () =>
            page.evaluate((before) => {
              const events = window.__extensionUiTest.lifecycle.slice(before);
              const started = events.findIndex(
                (event) =>
                  event.event === "view-start" &&
                  event.detail?.input === "date-difference",
              );
              return (
                started >= 0 &&
                events
                  .slice(started + 1)
                  .some((event) => event.event === "view-end")
              );
            }, before),
          { timeout: 60000 },
        )
        .toBe(true);
    }
    await idle();
    if (mode === "graph" && freshGraph) {
      await expect(frame.locator("#functions")).toHaveValue("");
      await openCalculatorGraphInput(frame);
      await expect(
        frame.locator("#equations input[data-equation]"),
      ).toHaveCount(1);
      await expect(
        frame.locator('#equations input[data-equation="0"]'),
      ).toHaveValue("");
      const plotStart = await page.evaluate(
        () => window.__extensionUiTest.lifecycle.length,
      );
      await frame.locator('#graph-input-pane [data-action="plot"]').click();
      await expect
        .poll(
          () =>
            page.evaluate((start) => {
              const events = window.__extensionUiTest.lifecycle.slice(start);
              const began = events.findIndex(
                (event) =>
                  event.event === "view-start" &&
                  event.detail?.input === "plot",
              );
              return (
                began >= 0 &&
                events
                  .slice(began + 1)
                  .some((event) => event.event === "view-end")
              );
            }, plotStart),
          { timeout: 60000 },
        )
        .toBe(true);
      await idle();
      await openCalculatorGraph(frame);
      await expect(frame.locator("#legend .dot")).toHaveCount(0);
      const plot = await frame
        .locator("html")
        .evaluate(() => JSON.parse(window.__sdkSnapshot.view.state).plot);
      expect(plot?.series).toEqual([]);
      await expect(frame.locator("#error")).toBeEmpty();
    }
    await snapshot(mode);
    if (mode === "standard" && page.viewportSize().width === 420) {
      await frame.locator("#navigation").click();
      await frame.locator("#standard-mode").scrollIntoViewIfNeeded();
      await snapshot("navigation");
      await frame.locator("#navigation-close").click();
    }
  }
  return {
    modes: ["standard", "scientific", "programmer", "date", "graph"],
    freshGraph,
    scope:
      "Navigation, visible layout, mode-field synchronization and accessibility; business math covered by the full profile",
  };
}

/** Windows-style keys use the packaged UI and the real calculator Wasm. */
export async function checkCalculatorWindowsKeys({ frame, action, idle }) {
  await openCalculatorMode(frame, "scientific");
  const columns = await frame
    .locator("#keypad")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" "));
  expect(columns).toHaveLength(5);
  const key = (name) => frame.locator(`#keypad button[data-key="${name}"]`);
  await pasteCalculatorExpression(frame, "0");
  for (const name of ["2", "power", "3"]) await key(name).click();
  await action("calculate");
  await expect(frame.locator("#result")).toHaveText("8");
  await key("second").click();
  await expect(key("second")).toHaveAttribute("aria-pressed", "true");
  await expect(key("cube")).toBeVisible();
  await expect(key("cbrt")).toBeVisible();
  await pasteCalculatorExpression(frame, "3");
  await key("cube").click();
  await expect(frame.locator("#result")).toHaveText("27", { timeout: 60000 });
  await idle();
  await expect(key("second")).toHaveAttribute("aria-pressed", "false");
  await expect(key("square")).toBeVisible();
  await pasteCalculatorExpression(frame, "6*7");
  await frame.locator("body").press("Enter");
  await expect(frame.locator("#result")).toHaveText("42", { timeout: 60000 });
  await idle();
  for (const [value, memoryAction] of [
    ["40", "memory-store"],
    ["2", "memory-add"],
    ["1", "memory-subtract"],
  ]) {
    await pasteCalculatorExpression(frame, value);
    await action("calculate");
    await action(memoryAction);
  }
  await frame.locator("#recall").click();
  await expect(frame.locator("#expression")).toHaveValue("41", {
    timeout: 60000,
  });
  await idle();
  await action("memory-clear");
  await expect(frame.locator("#recall")).toBeDisabled();
  return {
    columns: columns.length,
    powerKeys: true,
    secondFunctions: true,
    keyboardCalculation: true,
    memoryStoreAddSubtractRecall: true,
    realWasm: true,
  };
}

/** The final local edit survives an overlapping, deliberately slow real-Wasm locale refresh. */
export async function checkCalculatorBusyDraft({
  page,
  frame,
  idle,
  reload,
  phaseDelayMs = 0,
  transportTimingMock = false,
  errorDelayMs = 0,
  errorAfterIdle = false,
}) {
  await openCalculatorMode(frame, "scientific");
  const scientificExpression = await frame.locator("#expression").inputValue();
  await openCalculatorGraph(frame);
  const saved = await frame
    .locator("html")
    .evaluate(() =>
      Object.fromEntries(
        ["expression", "functions", "xmin", "xmax", "ymin", "ymax"].map(
          (id) => [id, document.getElementById(id).value],
        ),
      ),
    );
  const language = await page.evaluate(
    () => window.__extensionSettingsTest.read().language,
  );
  const evidenceStart = Date.now();
  await openCalculatorMode(frame, "scientific");
  await pasteCalculatorExpression(frame, "2468+1");
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe("2468+1");
  await openCalculatorGraphInput(frame);
  await frame.locator('#equations input[data-equation="0"]').fill("sin(x)+0.1");
  await page.evaluate(() => {
    window.__extensionUiTest.viewDelayMs = 1000;
  });
  if (phaseDelayMs) await page.waitForTimeout(phaseDelayMs);
  if (transportTimingMock) {
    const before = await page.evaluate(
      () =>
        window.__extensionUiTest.lifecycle.filter(
          (event) => event.event === "view-start",
        ).length,
    );
    await page.evaluate(
      ({ language, errorDelayMs, errorAfterIdle }) => {
        window.__extensionUiTest.transportTiming = {
          busyMs: 400,
          errorMs: errorDelayMs,
          errorAfterIdle,
        };
        window.__extensionSettingsTest.update({
          language: language === "zh" ? "en" : "zh",
        });
      },
      { language, errorDelayMs, errorAfterIdle },
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__extensionUiTest.lifecycle.filter(
                (event) => event.event === "view-start",
              ).length,
          ),
        { intervals: [10, 20, 30], timeout: 3000 },
      )
      .toBeGreaterThan(before);
  }
  await frame
    .locator('#equations input[data-equation="0"]')
    .fill("sin(x)+0.12");
  const retainedFunctions = await frame.locator("#functions").inputValue();
  await openCalculatorGraph(frame);
  await frame.locator("#graph").scrollIntoViewIfNeeded();
  const graph = await frame.locator("#graph").boundingBox();
  await page.mouse.move(
    graph.x + graph.width * 0.5,
    graph.y + graph.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    graph.x + graph.width * 0.6,
    graph.y + graph.height * 0.5,
  );
  await page.mouse.up();
  if (!transportTimingMock)
    await page.evaluate(
      (language) =>
        window.__extensionSettingsTest.update({
          language: language === "zh" ? "en" : "zh",
        }),
      language,
    );
  await expect
    .poll(
      () => frame.locator("html").evaluate(() => window.__sdkSnapshot.busy),
      { timeout: 5000 },
    )
    .toBe(true);
  await idle();
  await expect
    .poll(
      () =>
        frame
          .locator("html")
          .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.functions),
      { timeout: 6000 },
    )
    .toBe(retainedFunctions);
  const retained = await frame.locator("html").evaluate(() => ({
    inputs: Object.fromEntries(
      ["expression", "functions", "xmin", "xmax", "ymin", "ymax"].map((id) => [
        id,
        document.getElementById(id).value,
      ]),
    ),
    fields: window.__sdkSnapshot.fields,
    checkpoint: window.__sdkSnapshot.checkpoint,
  }));
  for (const [id, value] of Object.entries(retained.inputs)) {
    expect(retained.fields[id]).toBe(value);
    expect(retained.checkpoint.fields[id]).toBe(value);
  }
  const receipts = await page.evaluate(
    (start) => window.__protocolErrors.filter((event) => event.at >= start),
    evidenceStart,
  );
  if (transportTimingMock)
    expect(receipts.some((receipt) => receipt.error.code === "CONFLICT")).toBe(
      true,
    );
  if (errorAfterIdle)
    for (const receipt of receipts)
      expect(receipt.deliveredHostBusy).toBe(false);
  await reload();
  await openCalculatorGraph(frame);
  for (const [id, value] of Object.entries(retained.inputs))
    await expect(frame.locator("#" + id)).toHaveValue(value);
  await page.evaluate((language) => {
    window.__extensionUiTest.viewDelayMs = 0;
    window.__extensionUiTest.transportTiming = { busyMs: 0, errorMs: 0 };
    window.__extensionSettingsTest.update({ language });
  }, language);
  await idle();
  await openCalculatorMode(frame, "scientific");
  await expect(frame.locator("#expression")).toHaveValue("2468+1");
  await pasteCalculatorExpression(frame, scientificExpression);
  await setCalculatorFunctions(frame, saved.functions.split("\n"));
  await setCalculatorRange(
    frame,
    Object.fromEntries(
      Object.entries(saved).filter(([id]) =>
        ["xmin", "xmax", "ymin", "ymax"].includes(id),
      ),
    ),
  );
  await closeCalculatorRange(frame);
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe(saved.expression);
  return {
    boundaryTimingMock: true,
    realWasm: true,
    delayMs: 1000,
    phaseDelayMs,
    transportTimingMock,
    busyDeliveryDelayMs: transportTimingMock ? 400 : 0,
    errorDelayMs,
    errorAfterIdle,
    realConflictReceipts: receipts,
    busyObserved: true,
    retained,
    editedGraphEquation: retainedFunctions,
    independentScientificSessionRetained: true,
    reloadRetained: true,
  };
}

/** Trusted pointer/wheel/key input exercises real SDK admission and real Wasm resampling. */
export async function checkCalculatorGestures({
  page,
  frame,
  plotCount,
  idle,
}) {
  await openCalculatorMode(frame, "scientific");
  const previousExpression = await frame.locator("#expression").inputValue();
  const original = await frame
    .locator("html")
    .evaluate(() =>
      Object.fromEntries(
        ["xmin", "xmax", "ymin", "ymax"].map((id) => [
          id,
          document.getElementById(id).value,
        ]),
      ),
    );
  await pasteCalculatorExpression(frame, "12345+6");
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe("12345+6");
  await openCalculatorGraph(frame);
  const graphExpression = await frame.locator("#expression").inputValue();
  await frame.locator("#graph").scrollIntoViewIfNeeded();
  const graph = await frame.locator("#graph").boundingBox();
  const center = {
    x: graph.x + graph.width / 2,
    y: graph.y + graph.height / 2,
  };
  const startedAt = Date.now(),
    phases = [];
  async function resampled(before, phase) {
    await expect.poll(plotCount, { timeout: 60000 }).toBeGreaterThan(before);
    await idle();
    await expect(frame.locator("#expression")).toHaveValue(graphExpression);
    const fields = await frame.locator("html").evaluate(() => ({
      inputs: Object.fromEntries(
        ["xmin", "xmax", "ymin", "ymax"].map((id) => [
          id,
          document.getElementById(id).value,
        ]),
      ),
      fields: window.__sdkSnapshot.fields,
    }));
    for (const [id, value] of Object.entries(fields.inputs))
      expect(Number(fields.fields[id])).toBe(Number(value));
    expect(Number(fields.inputs.xmax)).toBeGreaterThan(
      Number(fields.inputs.xmin),
    );
    expect(Number(fields.inputs.ymax)).toBeGreaterThan(
      Number(fields.inputs.ymin),
    );
    phases.push({ phase, ...fields });
  }
  let before = plotCount();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let step = 0; step < 130; step++) {
    await page.mouse.move(
      center.x + Math.sin(step / 7) * Math.min(70, graph.width / 5),
      center.y + Math.cos(step / 11) * 35,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await resampled(before, "130 pointer moves");
  expect(phases[0].inputs.xmin).not.toBe(original.xmin);
  before = plotCount();
  await page.mouse.move(center.x, center.y);
  for (let step = 0; step < 60; step++) {
    await page.mouse.wheel(0, step < 30 ? -3 : 2);
    await page.waitForTimeout(16);
  }
  await resampled(before, "60 wheel events");
  before = plotCount();
  await frame.locator("#graph").focus();
  for (let step = 0; step < 70; step++) {
    await page.keyboard.press(step < 40 ? "ArrowRight" : step % 2 ? "+" : "-");
    await page.waitForTimeout(16);
  }
  await resampled(before, "70 viewport keys");
  const retained = phases.at(-1).inputs;
  const oldTheme = await frame
    .locator("html")
    .evaluate((node) => (node.classList.contains("dark") ? "dark" : "light"));
  await page.evaluate(
    (theme) => window.__extensionSettingsTest.update({ theme }),
    oldTheme === "dark" ? "light" : "dark",
  );
  await expect(frame.locator("#xmin")).toHaveValue(retained.xmin);
  await expect(frame.locator("#expression")).toHaveValue(graphExpression);
  await page.evaluate(
    (theme) => window.__extensionSettingsTest.update({ theme }),
    oldTheme,
  );
  await setCalculatorRange(frame, {
    xmin: "999999999900",
    xmax: "999999999900.001",
    ymin: "-5",
    ymax: "6",
  });
  before = plotCount();
  await frame.locator('#graph-settings [data-action="plot"]').click();
  await resampled(before, "large coordinate narrow range");
  await closeCalculatorRange(frame);
  before = plotCount();
  await frame.locator("#graph").focus();
  for (let step = 0; step < 6; step++) await page.keyboard.press("+");
  await resampled(before, "large coordinate zoom remains valid");
  const requests = await page.evaluate(
    (start) =>
      window.__iframeProtocolRequests.filter((item) => item.at >= start),
    startedAt,
  );
  const maximumPerSecond = Math.max(
    0,
    ...requests.map(
      (item) =>
        requests.filter(
          (other) => other.at >= item.at && other.at < item.at + 1000,
        ).length,
    ),
  );
  expect(maximumPerSecond).toBeLessThanOrEqual(60);
  await setCalculatorRange(frame, original);
  before = plotCount();
  await frame.locator('#graph-settings [data-action="plot"]').click();
  await resampled(before, "restored viewport");
  await closeCalculatorRange(frame);
  await openCalculatorMode(frame, "scientific");
  await expect(frame.locator("#expression")).toHaveValue("12345+6");
  await pasteCalculatorExpression(frame, previousExpression);
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe(previousExpression);
  await openCalculatorGraph(frame);
  return {
    requests,
    maximumPerSecond,
    phases,
    trustedInput: true,
    actualSdk: true,
    realWasmResampling: true,
    independentScientificSessionRetained: true,
  };
}

async function pendingStatus(page) {
  let index = -1;
  await expect
    .poll(
      async () => {
        index = await page.evaluate(() =>
          window.__extensionUiTest.serviceCalls.findLastIndex(
            (call) =>
              call.service === "lan" &&
              call.request.action === "status" &&
              !call.completed,
          ),
        );
        return index;
      },
      { timeout: 12000 },
    )
    .toBeGreaterThanOrEqual(0);
  return index;
}
async function statusFinished(page, index) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (index) => window.__extensionUiTest.serviceCalls[index].completed,
          index,
        ),
      { timeout: 5000 },
    )
    .toBe(true);
  await page.waitForTimeout(80);
}
async function watchEnabled(frame, id) {
  await frame.locator("html").evaluate((_node, id) => {
    const previous = window.__lanEnabledProbe;
    if (previous) {
      previous.running = false;
      clearInterval(previous.timer);
      cancelAnimationFrame(previous.raf);
    }
    const probe = {
      running: true,
      frames: 0,
      disabledFrames: 0,
      samples: 0,
      disabledSamples: 0,
      missingControls: 0,
    };
    window.__lanEnabledProbe = probe;
    const disabled = () => {
      const button = document.getElementById(id);
      if (!button) {
        probe.missingControls++;
        return false;
      }
      return button.disabled;
    };
    probe.timer = setInterval(() => {
      if (!probe.running) return;
      probe.samples++;
      if (disabled()) probe.disabledSamples++;
    }, 16);
    const sample = () => {
      if (!probe.running) return;
      probe.frames++;
      if (disabled()) probe.disabledFrames++;
      probe.raf = requestAnimationFrame(sample);
    };
    probe.raf = requestAnimationFrame(sample);
  }, id);
}
async function finishEnabled(frame) {
  const probe = await frame.locator("html").evaluate(() => {
    window.__lanEnabledProbe.running = false;
    clearInterval(window.__lanEnabledProbe.timer);
    cancelAnimationFrame(window.__lanEnabledProbe.raf);
    delete window.__lanEnabledProbe.timer;
    delete window.__lanEnabledProbe.raf;
    return window.__lanEnabledProbe;
  });
  expect(probe.samples).toBeGreaterThan(2);
  expect(probe.disabledFrames).toBe(0);
  expect(probe.disabledSamples).toBe(0);
  expect(probe.missingControls).toBe(0);
  return probe;
}

/** Real author HTML + SDK/host bridge; explicitly delayed native-service boundary substitutes. */
export async function checkLanPolling(page, frame) {
  if (!(await frame.locator("#settings-panel").isVisible()))
    await frame.locator("#settings-toggle").click();
  await expect(frame.locator("#nickname")).toHaveValue("Fixture device");
  await page.evaluate(() => {
    window.__extensionUiTest.serviceTiming.lanStatusMs = 1000;
  });
  await frame.locator("#nickname").fill("Unsubmitted polling nickname");
  await frame.locator("#draft").fill("Retained background draft");
  await watchEnabled(frame, "start");
  const beforeStart = await pendingStatus(page);
  await page.waitForTimeout(180);
  const stoppedProbe = await finishEnabled(frame);
  await frame.locator("#start").click();
  await expect(frame.locator("#stop")).toBeEnabled();
  await statusFinished(page, beforeStart);
  await expect(frame.locator("#stop")).toBeEnabled();
  await expect(frame.locator("#nickname")).toHaveValue(
    "Unsubmitted polling nickname",
  );
  await expect(frame.locator("#draft")).toHaveValue(
    "Retained background draft",
  );

  await frame.locator("#nickname").fill("New unsaved nickname");
  await watchEnabled(frame, "stop");
  const runningPoll = await pendingStatus(page);
  await statusFinished(page, runningPoll);
  const beforeStop = await pendingStatus(page);
  await page.waitForTimeout(180);
  const runningProbe = await finishEnabled(frame);
  await frame.locator("#stop").click();
  await expect(frame.locator("#start")).toBeEnabled();
  await statusFinished(page, beforeStop);
  await expect(frame.locator("#start")).toBeEnabled();
  await expect(frame.locator("#stop")).toBeDisabled();
  await expect(frame.locator("#nickname")).toHaveValue("New unsaved nickname");
  await expect(frame.locator("#draft")).toHaveValue(
    "Retained background draft",
  );

  await frame.locator("#start").click();
  await expect(frame.locator("#stop")).toBeEnabled();
  await frame.locator("#address").fill("192.168.1.21");
  await frame.locator("#connect").click();
  await expect(frame.locator("#contacts [data-peer]")).toHaveCount(1);
  await frame.locator("#close-settings").click();
  const beforeSend = await pendingStatus(page);
  await frame.locator("#draft").fill("Message retained after stale status");
  await frame.locator("#send").click();
  await expect(frame.locator("#draft")).toHaveValue("");
  await frame.locator("#draft").fill("New draft after send");
  await statusFinished(page, beforeSend);
  await expect(frame.locator("#messages")).toContainText(
    "Message retained after stale status",
  );
  await expect(frame.locator("#draft")).toHaveValue("New draft after send");

  await page.evaluate(() => {
    window.__extensionUiTest.serviceTiming.lanStatusMs = 0;
    window.__extensionUiTest.serviceTiming.lanNicknameMs = 800;
  });
  await frame.locator("#settings-toggle").click();
  await frame.locator("#nickname").fill("Submitted nickname");
  await frame.locator("#rename").click();
  await frame.locator("#nickname").fill("Newer nickname while saving");
  await expect(frame.locator("#rename")).toBeEnabled();
  await expect(frame.locator("#nickname")).toHaveValue(
    "Newer nickname while saving",
  );
  await frame.locator("#nickname").blur();
  await page.waitForTimeout(2200);
  await expect(frame.locator("#nickname")).toHaveValue(
    "Newer nickname while saving",
  );
  await expect(frame.locator("#draft")).toHaveValue("New draft after send");
  await frame.locator("#stop").click();
  await expect(frame.locator("#start")).toBeEnabled();
  await page.evaluate(() => {
    window.__extensionUiTest.serviceTiming.lanNicknameMs = 0;
  });
  await frame.locator("#nickname").fill("Fixture device");
  await frame.locator("#draft").fill("");
  await frame.locator("#close-settings").click();
  return {
    boundaryMock: true,
    statusDelayMs: 1000,
    nicknameDelayMs: 800,
    stoppedProbe,
    runningProbe,
    oldRepliesIgnoredAfter: ["start", "send", "stop"],
    nicknameEditedInFlightRetained: true,
  };
}

/** Real author UI + SDK/host bridge; file picking and the held response are explicit boundaryMock edges. */
export async function checkLanTransferCancellation(page, frame, services) {
  const gate = services.holdNextLanAttachment();
  const draft = frame.locator("#draft");
  const retainedDraft = "New draft edited while attachment send is pending";
  let sendingIndex = -1;
  try {
    await frame.locator("#settings-toggle").click();
    await expect(frame.locator("#nickname")).toHaveValue("Fixture device");
    await frame.locator("#start").click();
    await expect(frame.locator("#stop")).toBeEnabled();
    await frame.locator("#address").fill("192.168.1.21");
    await frame.locator("#connect").click();
    await expect(frame.locator("#contacts [data-peer]")).toHaveCount(1);
    await frame.locator("#close-settings").click();
    await draft.fill("Draft before attachment send");
    await frame.locator("html").evaluate(() => {
      const original = MessagePort.prototype.postMessage;
      const probe = { requestId: null, received: false, running: null };
      window.__lanCancelReceipt = probe;
      let removeReceipt;
      let receipt;
      const observe = function (message, ...args) {
        if (
          message?.method === "service" &&
          message.params?.service === "lan" &&
          message.params.request?.action === "sendAttachment" &&
          probe.requestId === null
        ) {
          probe.requestId = message.id;
          receipt = (event) => {
            if (event.data?.id !== probe.requestId) return;
            probe.received = true;
            probe.running = event.data.result?.running;
            this.removeEventListener("message", receipt);
          };
          removeReceipt = () => this.removeEventListener("message", receipt);
          this.addEventListener("message", receipt);
        }
        return original.call(this, message, ...args);
      };
      MessagePort.prototype.postMessage = observe;
      window.__lanCancelReceiptCleanup = () => {
        if (MessagePort.prototype.postMessage === observe)
          MessagePort.prototype.postMessage = original;
        removeReceipt?.();
      };
    });
    await frame.locator("#send-file").click();
    await expect.poll(gate.started, { timeout: 10000 }).toBe(true);
    await expect(frame.locator("#cancel-transfer")).toBeVisible();
    sendingIndex = await page.evaluate(() =>
      window.__extensionUiTest.serviceCalls.findLastIndex(
        (call) =>
          call.service === "lan" &&
          call.request.action === "sendAttachment" &&
          !call.completed,
      ),
    );
    expect(sendingIndex).toBeGreaterThanOrEqual(0);
    await draft.fill(retainedDraft);
    const stopsBefore = await page.evaluate(
      () =>
        window.__extensionUiTest.serviceCalls.filter(
          (call) => call.service === "lan" && call.request.action === "stop",
        ).length,
    );
    await frame.locator("#cancel-transfer").click();
    await expect
      .poll(
        () =>
          page.evaluate((count) => {
            const stops = window.__extensionUiTest.serviceCalls.filter(
              (call) =>
                call.service === "lan" && call.request.action === "stop",
            );
            return (
              stops.length === count + 1 &&
              stops.at(-1).completed &&
              stops.at(-1).response?.running === false
            );
          }, stopsBefore),
        { timeout: 10000 },
      )
      .toBe(true);
    await expect(frame.locator("#status")).toHaveText(
      /^(未连接|Disconnected)$/,
    );
    await expect(frame.locator("#cancel-transfer")).not.toBeVisible();
    await expect(draft).toHaveValue(retainedDraft);
    gate.release();
    await expect
      .poll(
        () =>
          page.evaluate(
            (index) => window.__extensionUiTest.serviceCalls[index].completed,
            sendingIndex,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    const lateResponse = await page.evaluate(
      (index) => window.__extensionUiTest.serviceCalls[index].response,
      sendingIndex,
    );
    expect(lateResponse.boundaryMock).toBe(true);
    expect(lateResponse.running).toBe(true);
    expect(lateResponse.peers.some((peer) => peer.connected)).toBe(true);
    await expect
      .poll(
        () =>
          frame
            .locator("html")
            .evaluate(() => window.__lanCancelReceipt.received),
        { timeout: 10000 },
      )
      .toBe(true);
    await frame
      .locator("html")
      .evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    expect(
      await frame
        .locator("html")
        .evaluate(() => window.__lanCancelReceipt.running),
    ).toBe(true);
    await expect(frame.locator("#status")).toHaveText(
      /^(未连接|Disconnected)$/,
    );
    await expect(frame.locator("#send")).toBeDisabled();
    await expect(draft).toHaveValue(retainedDraft);
    await expect
      .poll(
        () =>
          frame.locator("html").evaluate(() => ({
            draft: window.__sdkSnapshot.checkpoint?.draft,
            conversationDraft:
              window.__sdkSnapshot.checkpoint?.drafts?.["b".repeat(32)],
          })),
        { timeout: 10000 },
      )
      .toEqual({ draft: retainedDraft, conversationDraft: retainedDraft });
    // Let the successful Stop notification finish naturally before later toolbar checks.
    await frame.locator(".chat-head").hover({ position: { x: 12, y: 12 } });
    const stoppedNotice = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /传输已停止|The transfer stopped/ });
    await expect(stoppedNotice).not.toBeVisible({ timeout: 10000 });
    await draft.fill("");
    return {
      boundaryMock: true,
      actualSdkAndHostBridge: true,
      nativeTcp: false,
      systemFileDialog: false,
      stopReceiptCompleted: true,
      lateSdkReceiptObserved: true,
      lateRunningResponseIgnored: true,
      newerDraftAndCheckpointRetained: true,
    };
  } finally {
    gate.release();
    await frame
      .locator("html")
      .evaluate(() => window.__lanCancelReceiptCleanup?.())
      .catch(() => {});
  }
}

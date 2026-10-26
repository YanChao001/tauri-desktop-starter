import { expect } from "@playwright/test";

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
  const saved = await frame
    .locator("html")
    .evaluate(() =>
      Object.fromEntries(
        ["expression", "xmin", "xmax", "ymin", "ymax"].map((id) => [
          id,
          document.getElementById(id).value,
        ]),
      ),
    );
  const language = await page.evaluate(
    () => window.__extensionSettingsTest.read().language,
  );
  const evidenceStart = Date.now();
  await frame.locator("#expression").fill("2468+1");
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe("2468+1");
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
  await frame.locator("#expression").fill("2468+12");
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
          .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
      { timeout: 6000 },
    )
    .toBe("2468+12");
  const retained = await frame.locator("html").evaluate(() => ({
    inputs: Object.fromEntries(
      ["expression", "xmin", "xmax", "ymin", "ymax"].map((id) => [
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
  for (const [id, value] of Object.entries(retained.inputs))
    await expect(frame.locator("#" + id)).toHaveValue(value);
  await page.evaluate((language) => {
    window.__extensionUiTest.viewDelayMs = 0;
    window.__extensionUiTest.transportTiming = { busyMs: 0, errorMs: 0 };
    window.__extensionSettingsTest.update({ language });
  }, language);
  await idle();
  for (const [id, value] of Object.entries(saved))
    await frame.locator("#" + id).fill(value);
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
  await frame.locator("#expression").fill("12345+6");
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe("12345+6");
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
    await expect(frame.locator("#expression")).toHaveValue("12345+6");
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
  await expect(frame.locator("#expression")).toHaveValue("12345+6");
  await page.evaluate(
    (theme) => window.__extensionSettingsTest.update({ theme }),
    oldTheme,
  );
  for (const [id, value] of Object.entries({
    xmin: "999999999900",
    xmax: "999999999900.001",
    ymin: "-5",
    ymax: "6",
  }))
    await frame.locator("#" + id).fill(value);
  before = plotCount();
  await frame.locator('[data-action="plot"]').click();
  await resampled(before, "large coordinate narrow range");
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
  for (const [id, value] of Object.entries(original))
    await frame.locator("#" + id).fill(value);
  before = plotCount();
  await frame.locator('[data-action="plot"]').click();
  await resampled(before, "restored viewport");
  await frame.locator("#expression").fill(previousExpression);
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate(() => window.__sdkSnapshot.checkpoint?.fields?.expression),
    )
    .toBe(previousExpression);
  return {
    requests,
    maximumPerSecond,
    phases,
    trustedInput: true,
    actualSdk: true,
    realWasmResampling: true,
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

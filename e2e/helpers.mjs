import { browser, $ } from "@wdio/globals";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function ready(label = "main") {
  await $("#root main").waitForExist();
  await browser.waitUntil(
    () => browser.execute(() => Boolean(globalThis.__TAURI_INTERNALS__)),
    { timeoutMsg: "Tauri IPC did not initialize" },
  );
  await browser.waitUntil(
    async () =>
      (await invoke("plugin:window|is_visible", { label })).value === true,
  );
}

/** W3C execute 调用真正的原生桥；这里没有 mock 或 browser-only interceptor。 */
export function invoke(command, args = {}) {
  return browser.execute(
    async (name, payload) => {
      try {
        return {
          ok: true,
          value: await globalThis.__TAURI_INTERNALS__.invoke(name, payload),
        };
      } catch (error) {
        return { ok: false, failure: error };
      }
    },
    command,
    args,
  );
}

/** 仅观察真实原生事件；保留请求 ID，供跨窗口协商断言与回应。 */
export function observeLifecycle() {
  return browser.execute(async () => {
    globalThis.__STARTER_E2E_LIFECYCLE__?.stops.forEach((stop) => stop());
    const probe = { requests: [], finished: [], stops: [] };
    globalThis.__STARTER_E2E_LIFECYCLE__ = probe;
    const options = {
      target: {
        kind: "WebviewWindow",
        label: window.__TAURI__.window.getCurrentWindow().label,
      },
    };
    probe.stops = await Promise.all([
      window.__TAURI__.event.listen(
        "app://lifecycle-request",
        (event) => {
          probe.requests.push(event.payload);
        },
        options,
      ),
      window.__TAURI__.event.listen(
        "app://lifecycle-finished",
        (event) => {
          probe.finished.push(event.payload);
        },
        options,
      ),
    ]);
  });
}

export function lifecycleEvents() {
  return browser.execute(() => {
    const probe = globalThis.__STARTER_E2E_LIFECYCLE__;
    return { requests: probe?.requests ?? [], finished: probe?.finished ?? [] };
  });
}

export function stopObservingLifecycle() {
  return browser.execute(() => {
    globalThis.__STARTER_E2E_LIFECYCLE__?.stops.forEach((stop) => stop());
    delete globalThis.__STARTER_E2E_LIFECYCLE__;
  });
}

export async function waitForLifecycleDialogToClose() {
  try {
    await $("[role=dialog]").waitForExist({ reverse: true });
  } catch (error) {
    const state = await browser.execute(() => ({
      label: window.__TAURI__.window.getCurrentWindow().label,
      requests: globalThis.__STARTER_E2E_LIFECYCLE__?.requests,
      finished: globalThis.__STARTER_E2E_LIFECYCLE__?.finished,
      dialogs: [...document.querySelectorAll("[role=dialog]")].map((dialog) => {
        const style = getComputedStyle(dialog);
        return {
          state: dialog.getAttribute("data-state"),
          request: dialog.getAttribute("data-lifecycle-request"),
          text: dialog.textContent,
          animation: style.animationName,
          animationPlayState: style.animationPlayState,
          animationDuration: style.animationDuration,
        };
      }),
    }));
    writeFileSync(
      join(
        "artifacts",
        "e2e",
        process.env.STARTER_E2E_PHASE,
        `lifecycle-${state.label}.json`,
      ),
      JSON.stringify(state, null, 2),
    );
    throw error;
  }
}

export async function navigate(path) {
  const link = await $(`a[href="#${path}"]`);
  await link.click();
  await browser.waitUntil(() =>
    browser.execute(
      (expected) => globalThis.location.hash === `#${expected}`,
      path,
    ),
  );
}

/** 当前桌面驱动的 option.click() 只调用 DOM click，不实现原生 select 选择。 */
export function selectHtmlOption(selector, value) {
  return browser.execute(
    (target, selected) => {
      const select = document.querySelector(target);
      if (
        !(select instanceof HTMLSelectElement) ||
        ![...select.options].some((option) => option.value === selected)
      )
        throw new Error(
          `Select option is unavailable: ${target} / ${selected}`,
        );
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set;
      setter.call(select, selected);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    },
    selector,
    value,
  );
}

export async function language(locale) {
  const trigger = await $("button[aria-description][role=combobox]");
  await trigger.click();
  await $(`[role=option][lang="${locale === "en" ? "en" : "zh-CN"}"]`).click();
  await browser.waitUntil(() =>
    browser.execute(
      (expected) => globalThis.document.documentElement.lang === expected,
      locale === "en" ? "en" : "zh-CN",
    ),
  );
}

export function appearance() {
  return browser.execute(() => ({
    language: globalThis.document.documentElement.lang,
    background: globalThis.document.documentElement.dataset.background,
    intensity: globalThis.document.documentElement.dataset.backgroundIntensity,
  }));
}

export function windowPlacement() {
  return browser.execute(async () => {
    const win = window.__TAURI__.window.getCurrentWindow();
    const [position, size, monitors, scaleFactor] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      window.__TAURI__.window.availableMonitors(),
      win.scaleFactor(),
    ]);
    return {
      position,
      outerSize: size,
      workAreas: monitors.map(({ workArea }) => workArea),
      scaleFactor,
      centered: monitors.some(
        ({ workArea }) =>
          Math.abs(
            position.x +
              size.width / 2 -
              workArea.position.x -
              workArea.size.width / 2,
          ) <= 3 &&
          Math.abs(
            position.y +
              size.height / 2 -
              workArea.position.y -
              workArea.size.height / 2,
          ) <= 3,
      ),
    };
  });
}

export async function placeNearWorkAreaCorner() {
  const requested = await browser.execute(async () => {
    const win = window.__TAURI__.window.getCurrentWindow();
    const [outer, monitors] = await Promise.all([
      win.outerSize(),
      window.__TAURI__.window.availableMonitors(),
    ]);
    const area = monitors[0].workArea;
    // 小屏幕上窗口可能占满工作区，预留偏移不能让完整外框越界。
    const target = {
      x:
        area.position.x +
        Math.min(30, Math.max(0, area.size.width - outer.width)),
      y:
        area.position.y +
        Math.min(30, Math.max(0, area.size.height - outer.height)),
    };
    await win.setPosition(
      new window.__TAURI__.dpi.PhysicalPosition(target.x, target.y),
    );
    return { target, area, outer };
  });
  let actual;
  try {
    // 命令完成不代表窗口管理器已配置位置；夹具只记录已确认的实际坐标。
    await browser.waitUntil(
      async () => {
        actual = await browser.execute(() =>
          window.__TAURI__.window.getCurrentWindow().outerPosition(),
        );
        return (
          Math.abs(actual.x - requested.target.x) <= 2 &&
          Math.abs(actual.y - requested.target.y) <= 2
        );
      },
      {
        timeoutMsg: `Window placement did not reach ${JSON.stringify(requested)}`,
      },
    );
  } catch (error) {
    recordWindowPlacement("move-failed", {
      expected: requested.target,
      actual,
      area: requested.area,
      outerSize: requested.outer,
    });
    throw error;
  }
  return actual;
}

/** 隔离测试数据会被清理，保留位置与几何存档以便在 CI artifact 中核对。 */
export function recordWindowPlacement(checkpoint, details) {
  const readState = (name) => {
    try {
      return JSON.parse(
        readFileSync(
          join(process.env.STARTER_E2E_DATA_ROOT, "config", name),
          "utf8",
        ),
      );
    } catch (error) {
      return { error: error.code ?? error.message };
    }
  };
  const diagnostic = {
    platform: process.platform,
    phase: process.env.STARTER_E2E_PHASE,
    checkpoint,
    ...details,
    windowState: readState("window-state.json"),
    windowGeometry: readState("window-geometry.json"),
  };
  const directory = join("artifacts", "e2e", process.env.STARTER_E2E_PHASE);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `window-placement-${checkpoint}.json`),
    JSON.stringify(diagnostic, null, 2),
  );
  return diagnostic;
}

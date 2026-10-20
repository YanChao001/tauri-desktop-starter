import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $ } from "@wdio/globals";
import {
  appearance,
  invoke,
  language,
  navigate,
  ready,
  placeNearWorkAreaCorner,
} from "../helpers.mjs";

const execute = promisify(execFile);

describe("Real Tauri desktop", () => {
  it("reveals the main window and invokes Rust success and structured failure", async () => {
    await ready();
    assert.equal(
      (await invoke("plugin:window|is_visible", { label: "main" })).value,
      true,
    );
    const success = await invoke("greet", { name: " Ada ", language: "en" });
    assert.equal(success.ok, true);
    assert.match(success.value, /Hello, Ada!/);
    const failure = await invoke("greet", { name: "   ", language: "en" });
    assert.equal(failure.ok, false);
    assert.equal(failure.failure.code, "NAME_REQUIRED");
    assert.match(failure.failure.message, /Name cannot be empty/);
  });

  it("stays responsive when the application is launched repeatedly in parallel", async () => {
    await Promise.all(
      Array.from({ length: 6 }, () =>
        execute(process.env.STARTER_E2E_BINARY, [], {
          timeout: 7000,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        }),
      ),
    );
    assert.equal((await browser.getWindowHandles()).length, 1);
    const greeting = await invoke("greet", {
      name: "Relaunch",
      language: "en",
    });
    assert.equal(greeting.ok, true);
    assert.match(greeting.value, /Hello, Relaunch!/);
    await $("#root main").waitForDisplayed();
  });

  it("switches both languages through the title bar and renders real IPC results", async () => {
    await language("zh");
    await navigate("/settings");
    // 初始化为 minimal 的项目也可在隔离测试偏好中开启演示页面。
    await $("#settings-appMode button").click();
    await navigate("/bridge");
    await $("#name").setValue("桌面测试");
    await $("form button[type=submit]").click();
    await browser.waitUntil(async () =>
      (await $("[role=status]").getText()).includes("你好，桌面测试"),
    );
    await language("en");
    assert.match(await $("h2").getText(), /Rust|Bridge|IPC/);
    await $("#name").setValue("E2E");
    await $("form button[type=submit]").click();
    await browser.waitUntil(async () =>
      (await $("[role=status]").getText()).includes("Hello, E2E!"),
    );
    await $("#name").setValue("   ");
    await $("form button[type=submit]").click();
    await browser.waitUntil(async () =>
      (await $("[role=status]").getText()).includes("Call failed:"),
    );
    const rejected = await $("[role=status]").getText();
    assert.match(rejected, /check the input|Name cannot be empty/);
    assert.doesNotMatch(rejected, /\[object Object\]/);
  });

  it("previews, applies and undoes a showroom appearance through real native preferences", async () => {
    await navigate("/");
    await $("[data-testid=showroom]").waitForDisplayed();
    const original = await appearance();
    const originalNative = (await invoke("load_settings_snapshot")).value
      .settings;
    await $("label:has(input[name='showroom-vibe'][value='sakura'])").click();
    assert.deepEqual(await appearance(), original);
    await $("//button[normalize-space()='Apply to window']").click();
    await browser.waitUntil(
      async () => (await appearance()).background === "sakura",
    );
    await browser.waitUntil(async () => {
      const snapshot = await invoke("load_settings_snapshot");
      return (
        snapshot.ok &&
        snapshot.value.settings?.background === "sakura" &&
        snapshot.value.settings?.accent === "rose"
      );
    });
    await $("button[aria-label='Undo the change']").click();
    await browser.waitUntil(
      async () => (await appearance()).background === original.background,
    );
    await browser.waitUntil(
      async () => {
        const snapshot = await invoke("load_settings_snapshot");
        return (
          snapshot.ok &&
          [
            "background",
            "backgroundIntensity",
            "accent",
            "radius",
            "theme",
          ].every(
            (field) =>
              snapshot.value.settings?.[field] === originalNative?.[field],
          )
        );
      },
      {
        timeoutMsg: "The undone appearance did not persist in the native store",
      },
    );
    assert.deepEqual(await appearance(), original);
  });

  it("runs the interactive playground and controllable motion lab in the native WebView", async () => {
    await navigate("/components");
    await $("#studio-name").setValue("Native creative space");
    await browser.waitUntil(
      async () =>
        (await $("[data-testid=studio-preview-title]").getText()) ===
        "Native creative space",
    );
    await $(
      "//button[@role='tab'][contains(., 'Resource collection')]",
    ).click();
    await $("input[aria-label='Search sample resources']").setValue("Prism");
    await browser.waitUntil(async () =>
      (await $(".library-resource-grid").getText()).includes(
        "Prism visual toolkit",
      ),
    );
    await $("//button[@role='tab'][contains(., 'Creative studio')]").click();
    assert.equal(await $("#studio-name").getValue(), "Native creative space");
    await navigate("/motion");
    await $("[data-testid=spring-stage]").waitForDisplayed();
    const orbitTransform = () =>
      browser.execute(
        () =>
          getComputedStyle(
            document.querySelector(".lab-orbit-ring").parentElement,
          ).transform,
      );
    const firstTransform = await orbitTransform();
    await browser.waitUntil(
      async () => (await orbitTransform()) !== firstTransform,
      { timeout: 5000, timeoutMsg: "The SVG orbit did not move" },
    );
    await $("button[aria-label=Pause]").click();
    await browser.waitUntil(
      async () =>
        (await $(".motion-lab").getAttribute("data-paused")) === "true",
    );
    const pausedTransform = await orbitTransform();
    await browser.pause(150);
    assert.equal(await orbitTransform(), pausedTransform);
    await $("button[aria-label=Resume]").click();
    await browser.waitUntil(
      async () =>
        (await $(".motion-lab").getAttribute("data-paused")) === "false",
    );
    await $("#lab-tab-paths").click();
    await $(".lab-path-stage").waitForDisplayed();
    assert.equal(
      await $("#lab-tab-paths").getAttribute("aria-selected"),
      "true",
    );
    await browser.saveScreenshot("artifacts/e2e/fresh/motion-lab.png");
  });

  it("uses the actual native window maximize, restore and minimize controls", async () => {
    const original = await invoke("plugin:window|is_maximized", {
      label: "main",
    });
    assert.equal(original.ok, true);
    const toggle = async () => {
      // macOS 保留原生红绿灯，浏览器 DOM 中没有自绘窗口按钮。
      if (process.platform === "darwin") {
        assert.equal(
          (await invoke("plugin:window|toggle_maximize", { label: "main" })).ok,
          true,
        );
      } else {
        await $(
          "button[aria-label='Maximize'], button[aria-label='Restore']",
        ).click();
      }
    };
    await toggle();
    await browser.waitUntil(
      async () =>
        (await invoke("plugin:window|is_maximized", { label: "main" }))
          .value !== original.value,
    );
    await toggle();
    await browser.waitUntil(
      async () =>
        (await invoke("plugin:window|is_maximized", { label: "main" }))
          .value === original.value,
    );
    if (process.platform === "darwin")
      assert.equal(
        (await invoke("plugin:window|minimize", { label: "main" })).ok,
        true,
      );
    else await $("button[aria-label='Minimize']").click();
    await browser.waitUntil(
      async () =>
        (await invoke("plugin:window|is_minimized", { label: "main" }))
          .value === true,
    );
    assert.equal(
      (await invoke("plugin:window|unminimize", { label: "main" })).ok,
      true,
    );
    await invoke("plugin:window|set_focus", { label: "main" });
  });

  it("recovers an oversized off-screen window into an available work area", async () => {
    const original = await browser.execute(async () => {
      const win = window.__TAURI__.window.getCurrentWindow();
      const maximized = await win.isMaximized();
      if (maximized) await win.toggleMaximize();
      return {
        size: await win.innerSize(),
        position: await win.outerPosition(),
        maximized,
      };
    });
    try {
      await browser.execute(async () => {
        const win = window.__TAURI__.window.getCurrentWindow();
        const { PhysicalSize, PhysicalPosition } = window.__TAURI__.dpi;
        await win.setSize(new PhysicalSize(5000, 3500));
        await win.setPosition(new PhysicalPosition(50000, 50000));
      });
      await browser.waitUntil(
        async () =>
          browser.execute(async () => {
            const { getCurrentWindow, availableMonitors } =
              window.__TAURI__.window;
            const win = getCurrentWindow();
            const size = await win.outerSize();
            const position = await win.outerPosition();
            const monitors = await availableMonitors();
            return (
              size.width > 0 &&
              size.height > 0 &&
              monitors.some(
                ({ workArea }) =>
                  position.x >= workArea.position.x - 2 &&
                  position.y >= workArea.position.y - 2 &&
                  position.x + size.width <=
                    workArea.position.x + workArea.size.width + 2 &&
                  position.y + size.height <=
                    workArea.position.y + workArea.size.height + 2,
              )
            );
          }),
        {
          timeout: 10000,
          timeoutMsg: "Window did not recover into a monitor work area",
        },
      );
    } finally {
      await browser.execute(async (saved) => {
        const win = window.__TAURI__.window.getCurrentWindow();
        const { PhysicalSize, PhysicalPosition } = window.__TAURI__.dpi;
        await win.setSize(
          new PhysicalSize(saved.size.width, saved.size.height),
        );
        await win.setPosition(
          new PhysicalPosition(saved.position.x, saved.position.y),
        );
        if (saved.maximized && !(await win.isMaximized()))
          await win.toggleMaximize();
      }, original);
    }
  });

  it("applies size presets and restores default preferences without moving the window", async () => {
    await navigate("/settings");
    const initial = await invoke("get_window_geometry");
    assert.equal(initial.ok, true);
    const bounds = initial.value;
    assert.equal(
      bounds.width,
      Math.max(bounds.minWidth, Math.min(bounds.maxWidth, bounds.defaultWidth)),
    );
    assert.equal(
      bounds.height,
      Math.max(
        bounds.minHeight,
        Math.min(bounds.maxHeight, bounds.defaultHeight),
      ),
    );
    const compactFits =
      bounds.minWidth <= 960 &&
      bounds.maxWidth >= 960 &&
      bounds.minHeight <= 640 &&
      bounds.maxHeight >= 640;
    const width = compactFits
      ? 960
      : Math.max(
          bounds.minWidth,
          Math.min(bounds.maxWidth, bounds.defaultWidth),
        );
    const height = compactFits
      ? 640
      : Math.max(
          bounds.minHeight,
          Math.min(bounds.maxHeight, bounds.defaultHeight),
        );
    await browser.execute(async () => {
      const win = window.__TAURI__.window.getCurrentWindow();
      if (!(await win.isMaximized())) await win.toggleMaximize();
    });
    await browser.waitUntil(async () =>
      browser.execute(async () =>
        window.__TAURI__.window.getCurrentWindow().isMaximized(),
      ),
    );
    assert.equal(await $("#window-width").isExisting(), false);
    assert.equal(await $("#window-height").isExisting(), false);
    await $(
      `[data-window-preset='${compactFits ? "compact" : "standard"}']`,
    ).click();
    await browser.waitUntil(async () => {
      const result = await invoke("get_window_geometry");
      return (
        result.ok &&
        result.value.width === width &&
        result.value.height === height
      );
    });
    assert.equal(
      await browser.execute(async () =>
        window.__TAURI__.window.getCurrentWindow().isMaximized(),
      ),
      false,
    );
    const position = await browser.execute(async () =>
      window.__TAURI__.window.getCurrentWindow().outerPosition(),
    );
    await $("[data-window-position=center]").click();
    await browser.waitUntil(
      async () =>
        (await invoke("load_settings_snapshot")).value.settings
          ?.windowPosition === "center",
    );
    const afterPreference = await browser.execute(async () =>
      window.__TAURI__.window.getCurrentWindow().outerPosition(),
    );
    assert.deepEqual(afterPreference, position);
    await $("button=Reset preferences").click();
    assert.equal(await $("[role=dialog] [role=checkbox]").isExisting(), false);
    await $("[role=dialog]").$("button=Reset preferences").click();
    await $("[role=dialog]").waitForExist({ reverse: true });
    const reset = await invoke("get_window_geometry");
    assert.equal(reset.ok, true);
    assert.equal(
      (await invoke("load_settings_snapshot")).value.settings.windowPosition,
      "remember",
    );
    assert.equal(
      reset.value.width,
      Math.min(bounds.maxWidth, bounds.defaultWidth),
    );
    assert.equal(
      reset.value.height,
      Math.min(bounds.maxHeight, bounds.defaultHeight),
    );
    const unchanged = await browser.execute(async () =>
      window.__TAURI__.window.getCurrentWindow().outerPosition(),
    );
    assert.ok(
      Math.abs(position.x - unchanged.x) <= 2 &&
        Math.abs(position.y - unchanged.y) <= 2,
    );
    const invalid = await invoke("set_window_size", { width: 1, height: 1 });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.failure.code, "INVALID_ARGUMENT");
  });

  it("renders diagnostic JSON as highlighted inert text", async () => {
    await navigate("/diagnostics");
    await browser.waitUntil(async () =>
      (await $("[data-testid=diagnostics-report]").getText()).includes(
        "appVersion",
      ),
    );
    const report = await $("[data-testid=diagnostics-report]").getText();
    assert.equal(typeof JSON.parse(report).appVersion, "string");
    const colors = await browser.execute(() => {
      const block = document.querySelector("[data-testid=diagnostics-report]");
      const key = block.querySelector("[data-token=property]");
      return {
        keys: block.querySelectorAll("[data-token=property]").length,
        key: key && getComputedStyle(key).color,
        plain: getComputedStyle(block).color,
      };
    });
    assert.ok(colors.keys > 0);
    assert.notEqual(colors.key, colors.plain);
  });

  it("executes SQLite CRUD and rejects stale note updates before keeping a restart fixture", async () => {
    const created = await invoke("create_note", {
      input: { title: "E2E persisted note", body: "Initial body" },
    });
    assert.equal(created.ok, true);
    const updated = await invoke("update_note", {
      input: {
        id: created.value.id,
        title: "E2E persisted note",
        body: "Saved before app process restart",
        expectedVersion: created.value.version,
      },
    });
    assert.equal(updated.ok, true);
    assert.ok(updated.value.version > created.value.version);
    const stale = await invoke("update_note", {
      input: {
        id: created.value.id,
        title: "Stale overwrite",
        body: "Should be rejected",
        expectedVersion: created.value.version,
      },
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.failure.code, "CONFLICT");
    const listed = await invoke("list_notes", { search: "E2E persisted note" });
    assert.equal(listed.ok, true);
    assert.equal(listed.value.length, 1);
    assert.equal(listed.value[0].body, "Saved before app process restart");
    const temporary = await invoke("create_note", {
      input: { title: "E2E delete me", body: "" },
    });
    assert.equal(temporary.ok, true);
    assert.equal(
      (await invoke("delete_note", { id: temporary.value.id })).ok,
      true,
    );
    assert.deepEqual(
      (await invoke("list_notes", { search: "E2E delete me" })).value,
      [],
    );
  });

  it("reuses the secondary native window and synchronizes settings events both ways", async () => {
    const main = await browser.getWindowHandle();
    assert.equal((await browser.getWindowHandles()).length, 1);
    assert.equal((await invoke("open_secondary_window")).ok, true);
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 2,
    );
    const handles = await browser.getWindowHandles();
    const secondary = handles.find((handle) => handle !== main);
    assert.ok(secondary);
    assert.equal((await invoke("open_secondary_window")).ok, true);
    assert.deepEqual(
      (await browser.getWindowHandles()).sort(),
      [...handles].sort(),
    );
    await browser.switchToWindow(secondary);
    await ready("secondary");
    await language("zh");
    await browser.switchToWindow(main);
    await browser.waitUntil(
      async () => (await appearance()).language === "zh-CN",
    );
    await language("en");
    await browser.switchToWindow(secondary);
    await browser.waitUntil(async () => (await appearance()).language === "en");
    const secondaryBounds = (await invoke("get_window_geometry")).value;
    assert.equal(
      (
        await invoke("set_window_size", {
          width: Math.min(
            secondaryBounds.maxWidth,
            Math.max(secondaryBounds.minWidth, 980),
          ),
          height: Math.min(
            secondaryBounds.maxHeight,
            Math.max(secondaryBounds.minHeight, 650),
          ),
        })
      ).ok,
      true,
    );
    const secondaryPosition = await browser.execute(async () =>
      window.__TAURI__.window.getCurrentWindow().outerPosition(),
    );
    await browser.switchToWindow(main);
    assert.equal(
      (await invoke("reset_window_geometry", { center: false })).ok,
      true,
    );
    await browser.switchToWindow(secondary);
    await browser.waitUntil(async () => {
      const geometry = (await invoke("get_window_geometry")).value;
      return (
        geometry.width === Math.min(geometry.maxWidth, geometry.defaultWidth) &&
        geometry.height === Math.min(geometry.maxHeight, geometry.defaultHeight)
      );
    });
    const restoredPosition = await browser.execute(async () =>
      window.__TAURI__.window.getCurrentWindow().outerPosition(),
    );
    assert.ok(
      Math.abs(secondaryPosition.x - restoredPosition.x) <= 2 &&
        Math.abs(secondaryPosition.y - restoredPosition.y) <= 2,
    );
    await browser.switchToWindow(main);
    assert.equal(
      (await invoke("plugin:window|close", { label: "secondary" })).ok,
      true,
    );
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 1,
    );
  });

  it("persists language and illustration settings for a separate app process", async () => {
    await navigate("/settings");
    await $("label:has(input[name='background-skin'][value='sakura'])").click();
    await $(
      "label:has(input[name='background-intensity'][value='strong'])",
    ).click();
    await browser.waitUntil(async () => {
      const actual = await appearance();
      return (
        actual.language === "en" &&
        actual.background === "sakura" &&
        actual.intensity === "strong"
      );
    });
    // 等待异步原生偏好快照落盘，后续进程从同一隔离目录读取。
    await browser.waitUntil(async () => {
      const result = await invoke("load_settings_snapshot");
      return (
        result.ok &&
        result.value.settings?.language === "en" &&
        result.value.settings?.background === "sakura" &&
        result.value.settings?.backgroundIntensity === "strong"
      );
    });
    const geometry = (await invoke("get_window_geometry")).value;
    assert.equal(
      (
        await invoke("set_window_size", {
          width: Math.min(geometry.maxWidth, Math.max(geometry.minWidth, 1000)),
          height: Math.min(
            geometry.maxHeight,
            Math.max(geometry.minHeight, 680),
          ),
        })
      ).ok,
      true,
    );
    await $("[data-window-position=remember]").click();
    await browser.waitUntil(
      async () =>
        (await invoke("load_settings_snapshot")).value.settings
          ?.windowPosition === "remember",
    );
    const position = await placeNearWorkAreaCorner();
    writeFileSync(
      join(process.env.STARTER_E2E_DATA_ROOT, "window-placement-fixture.json"),
      JSON.stringify(position),
    );
    // 测试 runner 会强制回收进程，先调用原生插件完成正常退出时的位置写盘。
    assert.equal(
      (await invoke("plugin:window-state|save_window_state", { flags: 2 })).ok,
      true,
    );
  });
});
/* global describe, it */

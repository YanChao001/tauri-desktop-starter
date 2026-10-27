import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $ } from "@wdio/globals";
import {
  appearance,
  invoke,
  language,
  lifecycleEvents,
  navigate,
  observeLifecycle,
  ready,
  placeNearWorkAreaCorner,
  recordWindowPlacement,
  windowPlacement,
  stopObservingLifecycle,
  waitForLifecycleDialogToClose,
} from "../helpers.mjs";

import { desktopUiChecks } from "./desktop-ui.mjs";
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
    await browser.waitUntil(
      async () => (await $("main h2").getText()) === "应用通信",
    );
    await $("#name").setValue("桌面测试");
    await $("form button[type=submit]").click();
    await browser.waitUntil(async () =>
      (await $("main [role=status]").getText()).includes("你好，桌面测试"),
    );
    await language("en");
    assert.equal(await $("main h2").getText(), "App communication");
    await $("#name").setValue("E2E");
    await $("form button[type=submit]").click();
    await browser.waitUntil(async () =>
      (await $("main [role=status]").getText()).includes("Hello, E2E!"),
    );
    const previousResult = await $("main [role=status]").getText();
    await $("#name").setValue("   ");
    await $("form button[type=submit]").click();
    const errorToast = await $('[data-sonner-toast][data-type="error"]');
    await errorToast.waitForDisplayed();
    const rejected = await errorToast.getText();
    assert.match(rejected, /Call failed:/);
    assert.match(rejected, /check the input|Name cannot be empty/);
    assert.doesNotMatch(rejected, /\[object Object\]/);
    assert.equal(await $("main [role=status]").getText(), previousResult);
  });

  desktopUiChecks();

  it("previews, applies and undoes a showroom appearance through real native preferences", async () => {
    await navigate("/");
    await browser.waitUntil(async () =>
      $("[data-testid=showroom]").isDisplayed(),
    );
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
    await $("[data-testid=spring-stage]").scrollIntoView({
      block: "center",
      inline: "nearest",
    });
    const systemReduced = await browser.execute(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const savedPreferences = await invoke("load_settings_snapshot");
    assert.equal(savedPreferences.ok, true);
    const reduced =
      systemReduced || savedPreferences.value.settings?.motion === "reduced";
    // CI 系统可能启用减少动态效果；同时校验真实偏好与页面状态，避免把静态策略当作动画故障。
    assert.equal(
      await $(".motion-lab").getAttribute("data-reduced"),
      String(reduced),
    );
    const orbitTransform = () =>
      browser.execute(
        () =>
          getComputedStyle(
            document.querySelector(".lab-orbit-ring").parentElement,
          ).transform,
      );
    if (reduced) {
      assert.equal(await $("button[aria-label=Pause]").isEnabled(), false);
      const stillTransform = await orbitTransform();
      await browser.pause(150);
      assert.equal(await orbitTransform(), stillTransform);
      // 减少动态效果只移除过渡，控件仍应改变实际场景。
      const orbLeft = () =>
        browser.execute(
          () =>
            document.querySelector(".lab-orb-rim").getBoundingClientRect().left,
        );
      const originalLeft = await orbLeft();
      await $("button[aria-label='Send left']").click();
      await browser.waitUntil(
        async () => Math.abs((await orbLeft()) - originalLeft) > 5,
        { timeout: 5000, timeoutMsg: "The reduced-motion orb did not respond" },
      );
    } else {
      // 动画仅在可见舞台运行，先等待可见性状态，再验证播放、暂停和继续后的真实运动。
      await browser.waitUntil(
        async () =>
          (await $(".motion-lab").getAttribute("data-paused")) === "false",
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
      // 播放状态提交后，等待已排队的绘制帧完成，再采样暂停后的实际画面。
      await browser.execute(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const pausedTransform = await orbitTransform();
      await browser.pause(150);
      assert.equal(await orbitTransform(), pausedTransform);
      await $("button[aria-label=Resume]").click();
      await browser.waitUntil(
        async () =>
          (await $(".motion-lab").getAttribute("data-paused")) === "false",
      );
      const resumedTransform = await orbitTransform();
      await browser.waitUntil(
        async () => (await orbitTransform()) !== resumedTransform,
        { timeout: 5000, timeoutMsg: "The SVG orbit did not resume" },
      );
    }
    await $("#lab-tab-paths").click();
    await $(".lab-path-stage").waitForDisplayed();
    assert.equal(
      await $("#lab-tab-paths").getAttribute("aria-selected"),
      "true",
    );
    await browser.saveScreenshot("artifacts/e2e/fresh/motion-lab.png");
  });

  it("uses the actual native window maximize, restore and minimize controls", async () => {
    // 小工作区先建立与最大化尺寸不同的正常窗口，保证原生缩放有明确的还原目标。
    const savedGeometry =
      process.platform === "darwin"
        ? await invoke("get_window_geometry")
        : null;
    try {
      if (savedGeometry) {
        assert.equal(savedGeometry.ok, true);
        const { minWidth, minHeight } = savedGeometry.value;
        const resized = await invoke("set_window_size", {
          width: minWidth,
          height: minHeight,
        });
        assert.equal(resized.ok, true);
        await browser.waitUntil(async () => {
          const current = await invoke("get_window_geometry");
          return (
            current.ok &&
            current.value.width === minWidth &&
            current.value.height === minHeight &&
            !(await invoke("plugin:window|is_maximized", { label: "main" }))
              .value
          );
        });
      }
      const original = await invoke("plugin:window|is_maximized", {
        label: "main",
      });
      assert.equal(original.ok, true);
      const toggle = async () => {
        // macOS 保留原生红绿灯，浏览器 DOM 中没有自绘窗口按钮。
        if (process.platform === "darwin") {
          assert.equal(
            (await invoke("plugin:window|toggle_maximize", { label: "main" }))
              .ok,
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
    } finally {
      if (savedGeometry?.ok) {
        const restored = await invoke("set_window_size", {
          width: savedGeometry.value.width,
          height: savedGeometry.value.height,
        });
        assert.equal(restored.ok, true);
      }
    }
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
    const preset = await $(
      `[data-window-preset='${compactFits ? "compact" : "standard"}']`,
    );
    await preset.waitForEnabled();
    await preset.click();
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
    const centered = await $("[data-window-position=center]");
    await centered.waitForEnabled();
    await centered.click();
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
    await $("summary=View detailed report and logs").click();
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
    const query = {
      search: "E2E persisted note",
      offset: 0,
      limit: 50,
      sort: "updated-desc",
      trash: false,
    };
    const listed = await invoke("query_notes", { query });
    assert.equal(listed.ok, true);
    assert.equal(listed.value.total, 1);
    assert.equal(
      listed.value.items[0].body,
      "Saved before app process restart",
    );
    const temporary = await invoke("create_note", {
      input: { title: "E2E delete me", body: "" },
    });
    assert.equal(temporary.ok, true);
    assert.equal(
      (
        await invoke("change_notes", {
          items: [
            {
              id: temporary.value.id,
              expectedVersion: temporary.value.version,
            },
          ],
          action: "trash",
        })
      ).ok,
      true,
    );
    assert.deepEqual(
      (
        await invoke("query_notes", {
          query: { ...query, search: "E2E delete me" },
        })
      ).value.items,
      [],
    );
  });

  it("runs the fixed native worker protocol with real Unicode output", async () => {
    const input = "Native 世界 ; echo $HOME";
    const result = await invoke("run_demo_sidecar", { input });
    assert.equal(result.ok, true);
    assert.equal(result.value.exitCode, 0);
    assert.equal(result.value.stderr, "");
    assert.deepEqual(JSON.parse(result.value.stdout), {
      input,
      characters: Array.from(input).length,
      uppercase: input.toUpperCase(),
    });
    const invalid = await invoke("run_demo_sidecar", {
      input: "x".repeat(1001),
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.failure.code, "INPUT_TOO_LONG");
  });

  it("round-trips every paginated note, recycled item and schema-2 draft through a real backup", async () => {
    const baseline = await invoke("create_data_backup");
    assert.equal(baseline.ok, true);
    const search = "E2E pagination fixture ";
    const query = {
      search,
      offset: 0,
      limit: 100,
      sort: "title-asc",
      trash: false,
    };
    try {
      const notes = await browser.execute(async (prefix) => {
        const created = [];
        for (let index = 0; index < 251; index += 1) {
          created.push(
            await globalThis.__TAURI_INTERNALS__.invoke("create_note", {
              input: {
                title: `${prefix}${String(index).padStart(3, "0")}`,
                body: `Persisted record ${index}`,
              },
            }),
          );
        }
        return created;
      }, search);
      assert.equal(notes.length, 251);
      const tail = await invoke("query_notes", {
        query: { ...query, offset: 200 },
      });
      assert.equal(tail.ok, true);
      assert.equal(tail.value.total, 251);
      assert.equal(tail.value.items.length, 51);
      assert.equal(tail.value.items.at(-1).title, `${search}250`);
      assert.equal((await invoke("query_notes", { query })).value.total, 251);
      await navigate("/database");
      await $("input[type=search]").setValue(search);
      await $("#notes-sort").click();
      const titleOption = $(
        "//*[@role='option' and normalize-space(.)='Title']",
      );
      await titleOption.waitForDisplayed();
      await titleOption.click();
      await $("[role=listbox]").waitForExist({ reverse: true });
      assert.equal(await $("#notes-sort").getText(), "Title");
      await browser.waitUntil(async () =>
        $(`[role=checkbox][aria-label='Select ${search}000']`).isExisting(),
      );
      for (let page = 0; page <= 5; page += 1) {
        const range = `${page * 50 + 1}–${Math.min((page + 1) * 50, 251)} of 251`;
        await browser.waitUntil(() =>
          browser.execute(
            (expected) =>
              [...document.querySelectorAll("main button")].some(
                (button) =>
                  button.textContent.trim() === "Next" &&
                  button.parentElement.textContent.includes(expected),
              ),
            range,
          ),
        );
        // 分页位于列表自身的滚动区底部，getText 只返回可见文本。
        await $("button=Next").scrollIntoView({ block: "center" });
        assert.ok((await $("main").getText()).includes(range));
        if (page < 5) await $("button=Next").click();
      }
      assert.equal(
        await $(
          `[role=checkbox][aria-label='Select ${search}250']`,
        ).isExisting(),
        true,
      );
      assert.equal(await $("button=Next").isEnabled(), false);
      await navigate("/diagnostics");
      const versions = notes.slice(0, 2).map((note) => ({
        id: note.id,
        expectedVersion: note.version,
      }));
      const conflict = await invoke("change_notes", {
        action: "trash",
        items: [versions[0], { ...versions[1], expectedVersion: 9999 }],
      });
      assert.equal(conflict.ok, false);
      assert.equal(conflict.failure.code, "CONFLICT");
      assert.equal((await invoke("query_notes", { query })).value.total, 251);
      assert.equal(
        (await invoke("change_notes", { action: "trash", items: versions })).ok,
        true,
      );
      const draft = {
        noteId: notes[250].id,
        title: `${search}250 local draft`,
        body: "Unsaved text survives backup and restore 世界",
        expectedVersion: notes[250].version,
        originalTitle: notes[250].title,
        originalBody: notes[250].body,
      };
      assert.equal((await invoke("save_note_draft", { draft })).ok, true);
      const backup = await invoke("create_data_backup");
      assert.equal(backup.ok, true);
      assert.equal(backup.value.notes, baseline.value.notes + 249);
      assert.equal(backup.value.trashed, baseline.value.trashed + 2);
      assert.equal(backup.value.drafts, 1);
      const exported = await invoke("export_data_backup", {
        id: backup.value.id,
      });
      assert.equal(exported.ok, true);
      const document = JSON.parse(exported.value);
      assert.equal(document.schemaVersion, 2);
      assert.equal(
        document.notes.filter(({ note }) => note.title.startsWith(search))
          .length,
        251,
      );
      assert.deepEqual(
        document.drafts.find(({ windowLabel }) => windowLabel === "main").draft,
        draft,
      );
      assert.equal((await invoke("save_note_draft", { draft: null })).ok, true);
      assert.equal(
        (
          await invoke("update_note", {
            input: {
              id: notes[250].id,
              title: notes[250].title,
              body: "Changed after backup",
              expectedVersion: notes[250].version,
            },
          })
        ).ok,
        true,
      );
      const imported = await invoke("import_data_backup", {
        contents: exported.value,
      });
      assert.equal(imported.ok, true);
      assert.equal(imported.value.schemaVersion, 2);
      const restored = await invoke("restore_data_backup", {
        id: imported.value.info.id,
      });
      assert.equal(restored.ok, true);
      assert.ok(restored.value.safetyBackup.id);
      assert.equal(restored.value.restored, document.notes.length);
      const restoredTail = await invoke("query_notes", {
        query: { ...query, offset: 200 },
      });
      assert.equal(restoredTail.value.total, 249);
      assert.equal(
        restoredTail.value.items.at(-1).body,
        "Persisted record 250",
      );
      const restoredDraft = await invoke("load_note_draft");
      assert.equal(restoredDraft.value.body, draft.body);
      assert.ok(restoredDraft.value.expectedVersion > draft.expectedVersion);
      const recycled = await invoke("query_notes", {
        query: { ...query, trash: true },
      });
      assert.equal(recycled.value.total, 2);
      assert.equal(
        (
          await invoke("change_notes", {
            action: "restore",
            items: recycled.value.items.map((note) => ({
              id: note.id,
              expectedVersion: note.version,
            })),
          })
        ).ok,
        true,
      );
      assert.equal((await invoke("query_notes", { query })).value.total, 251);
    } catch (error) {
      const state = await browser.execute(() => ({
        route: location.hash,
        sort: document.querySelector("#notes-sort")?.textContent,
        search: document.querySelector("main input[type=search]")?.value,
        selectedNotes: [
          ...document.querySelectorAll("main [role=checkbox][aria-label]"),
        ].map((input) => input.getAttribute("aria-label")),
        page: document.querySelector("main")?.textContent,
      }));
      writeFileSync(
        join("artifacts", "e2e", "fresh", "data-round-trip.json"),
        JSON.stringify(state, null, 2),
      );
      throw error;
    } finally {
      const restored = await invoke("restore_data_backup", {
        id: baseline.value.id,
      });
      assert.equal(
        restored.ok,
        true,
        "The original restart fixture must be restored",
      );
    }
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

  it("cancels a real two-window quit request without losing either persisted draft", async () => {
    const main = await browser.getWindowHandle();
    let secondary;
    let requestId;
    const drafts = {
      main: {
        title: "E2E main unsaved draft",
        body: "Main text retained after cancelling quit",
      },
      secondary: {
        title: "E2E secondary unsaved draft",
        body: "Secondary text retained after cancelling quit",
      },
    };
    const editDraft = async (label) => {
      await navigate("/database");
      await $("#note-title").waitForEnabled();
      await $("#note-title").setValue(drafts[label].title);
      await $("#note-body").setValue(drafts[label].body);
      await browser.waitUntil(async () => {
        const saved = await invoke("load_note_draft");
        return saved.ok && saved.value?.body === drafts[label].body;
      });
      await observeLifecycle();
    };
    try {
      await editDraft("main");
      assert.equal((await invoke("open_secondary_window")).ok, true);
      await browser.waitUntil(
        async () => (await browser.getWindowHandles()).length === 2,
      );
      secondary = (await browser.getWindowHandles()).find(
        (handle) => handle !== main,
      );
      assert.ok(secondary);
      await browser.switchToWindow(secondary);
      await ready("secondary");
      await editDraft("secondary");
      await browser.switchToWindow(main);
      assert.equal((await invoke("quit_app")).ok, true);
      await browser.waitUntil(
        async () => (await lifecycleEvents()).requests.length === 1,
      );
      const request = (await lifecycleEvents()).requests[0];
      requestId = request.id;
      assert.equal(request.action, "quit");
      assert.deepEqual([...request.windows].sort(), ["main", "secondary"]);
      await browser.switchToWindow(secondary);
      await browser.waitUntil(
        async () => (await lifecycleEvents()).requests.length === 1,
      );
      assert.equal((await lifecycleEvents()).requests[0].id, requestId);
      const stale = await invoke("respond_lifecycle", {
        id: requestId + 1,
        approved: false,
      });
      assert.equal(stale.ok, false);
      assert.equal(stale.failure.code, "CONFLICT");
      assert.equal(
        (await invoke("respond_lifecycle", { id: requestId, approved: false }))
          .ok,
        true,
      );
      for (const [handle, label] of [
        [secondary, "secondary"],
        [main, "main"],
      ]) {
        await browser.switchToWindow(handle);
        await browser.waitUntil(async () =>
          (await lifecycleEvents()).finished.includes(requestId),
        );
        await waitForLifecycleDialogToClose();
        assert.equal(
          (await invoke("load_note_draft")).value.body,
          drafts[label].body,
        );
        assert.equal(await $("#note-body").getValue(), drafts[label].body);
      }
      assert.equal((await browser.getWindowHandles()).length, 2);
      assert.equal(
        (await invoke("greet", { name: "Still running", language: "en" })).ok,
        true,
      );
    } finally {
      for (const handle of [secondary, main].filter(Boolean)) {
        if (!(await browser.getWindowHandles()).includes(handle)) continue;
        await browser.switchToWindow(handle);
        if (requestId !== undefined)
          await invoke("respond_lifecycle", { id: requestId, approved: false });
        await waitForLifecycleDialogToClose();
        const discard = await $("button=Discard current edits");
        if (await discard.isExisting()) await discard.click();
        await browser.waitUntil(
          async () => (await invoke("load_note_draft")).value === null,
        );
        await stopObservingLifecycle();
      }
      await browser.switchToWindow(main);
      if (secondary && (await browser.getWindowHandles()).includes(secondary)) {
        assert.equal(
          (await invoke("plugin:window|close", { label: "secondary" })).ok,
          true,
        );
        await browser.waitUntil(
          async () => (await browser.getWindowHandles()).length === 1,
        );
      }
    }
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
    const snapshot = (await invoke("load_settings_snapshot")).value;
    const customBackground = JSON.parse(
      readFileSync(
        join(
          process.env.STARTER_E2E_DATA_ROOT,
          "background-image-fixture.json",
        ),
        "utf8",
      ),
    );
    assert.equal(
      (
        await invoke("save_settings_snapshot", {
          settings: { ...snapshot.settings, customBackground },
          expectedRevision: snapshot.revision,
        })
      ).ok,
      true,
    );
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
    recordWindowPlacement("before-restart", {
      expected: position,
      ...(await windowPlacement()),
    });
  });
});
/* global describe, it */

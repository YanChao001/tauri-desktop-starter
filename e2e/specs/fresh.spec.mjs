import assert from "node:assert/strict";
import { browser, $ } from "@wdio/globals";
import { appearance, invoke, language, navigate, ready } from "../helpers.mjs";

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
  });
});
/* global describe, it */

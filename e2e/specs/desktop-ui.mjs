import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, $$ } from "@wdio/globals";
import { appearance, invoke, language, navigate, ready } from "../helpers.mjs";

async function patchSettings(patch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await invoke("load_settings_snapshot");
    assert.equal(snapshot.ok, true);
    const result = await invoke("save_settings_snapshot", {
      settings: { ...snapshot.value.settings, ...patch, schemaVersion: 3 },
      expectedRevision: snapshot.value.revision,
    });
    if (result.ok) return result.value;
    assert.equal(result.failure.code, "SETTINGS_CONFLICT");
  }
  throw new Error("Native preferences did not settle");
}
async function settledAppearance(expected) {
  await browser.waitUntil(() =>
    browser.execute((values) => {
      const root = document.documentElement;
      return Object.entries(values).every(([key, value]) =>
        key === "theme"
          ? root.classList.contains(
              value === "system"
                ? matchMedia("(prefers-color-scheme: dark)").matches
                  ? "dark"
                  : "light"
                : value,
            )
          : key === "language"
            ? root.lang === (value === "zh" ? "zh-CN" : "en")
            : root.dataset[key] === String(value),
      );
    }, expected),
  );
  await browser.execute(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}
function geometry() {
  return browser.execute(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      content: rect(".app-page-content"),
      main: rect("main"),
      chrome: rect(".app-chrome"),
      artwork: rect("[data-window-background]"),
      scrollTop: document.querySelector("main").scrollTop,
      rootScrollTop: document.scrollingElement.scrollTop,
    };
  });
}
async function screenshot(name) {
  await browser.execute(async () => {
    await Promise.all(
      [...document.querySelectorAll(".skin-scene")].map((element) => {
        const image = new Image();
        image.src = getComputedStyle(element).maskImage.slice(5, -2);
        return image.decode();
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await browser.saveScreenshot(join("artifacts", "e2e", "fresh", name));
}

export function desktopUiChecks() {
  it("keeps wheel tails native without replaying edge animations in WebView2", async function () {
    if (
      await browser.execute(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      )
    )
      this.skip();
    const original = (await invoke("load_settings_snapshot")).value.settings;
    try {
      await patchSettings({ motion: "full", sidebarCollapsed: false });
      await navigate("/settings");
      await settledAppearance({ motion: "full" });
      for (const selector of ["main", ".app-sidebar-navigation"]) {
        const result = await browser.execute(async (target) => {
          const viewport = document.querySelector(target);
          viewport.scrollTop = viewport.scrollHeight;
          const height = viewport.scrollHeight;
          let scripted = false;
          for (const delta of [120, 100, 80, 50, 30, 20, 12, 6, 3, 1]) {
            viewport.dispatchEvent(
              new WheelEvent("wheel", { deltaY: delta, bubbles: true }),
            );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            let node = viewport.querySelector(
              ".app-page-content, [role='group']",
            );
            while (node && node !== viewport) {
              scripted ||=
                node.getAnimations().length > 0 ||
                getComputedStyle(node).translate !== "none";
              node = node.parentElement;
            }
          }
          return {
            scripted,
            policy: getComputedStyle(viewport).overscrollBehaviorY,
            stableRange: viewport.scrollHeight === height,
            documentTop: document.scrollingElement.scrollTop,
          };
        }, selector);
        assert.equal(
          result.scripted,
          false,
          selector + " leaves edge feedback to WebView2",
        );
        assert.equal(result.policy, "contain");
        assert.equal(result.stableRange, true);
        assert.equal(result.documentTop, 0);
      }
    } finally {
      await patchSettings(original);
      await settledAppearance({ motion: original.motion });
    }
  });

  it("keeps native menu geometry stable, aligns settings and records real desktop screenshots", async () => {
    const original = (await invoke("load_settings_snapshot")).value.settings;
    const originalWindow = (await invoke("get_window_geometry")).value;
    try {
      const size = await invoke("set_window_size", {
        width: Math.min(
          originalWindow.maxWidth,
          Math.max(originalWindow.minWidth, 1280),
        ),
        height: Math.min(
          originalWindow.maxHeight,
          Math.max(originalWindow.minHeight, 840),
        ),
      });
      assert.equal(size.ok, true);
      await patchSettings({
        language: "zh",
        theme: "light",
        accent: "emerald",
        background: "aurora",
        motion: "reduced",
        sidebarCollapsed: false,
        sidebarWidth: 224,
        menuBar: true,
        fontSize: "md",
      });
      await settledAppearance({
        language: "zh",
        theme: "light",
        background: "aurora",
      });
      await navigate("/");
      await $("[data-testid=showroom]").waitForDisplayed();
      await $("[data-sonner-toast]").waitForExist({ reverse: true });
      await browser.execute(async () => {
        document.activeElement?.blur();
        document.querySelector("main").scrollTop = 0;
        document.querySelector(".app-sidebar-navigation").scrollTop = 0;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      assert.equal((await geometry()).scrollTop, 0);
      await screenshot("desktop-light.png");
      await patchSettings({ theme: "dark" });
      await settledAppearance({ theme: "dark" });
      await screenshot("desktop-dark.png");
      await navigate("/settings");
      await $(".skin-gallery").waitForDisplayed();
      await screenshot("desktop-settings.png");
      const galleryWidth = Math.max(
        originalWindow.minWidth,
        Math.min(1120, size.value.width),
      );
      const gallerySize = await invoke("set_window_size", {
        width: galleryWidth,
        height: size.value.height,
      });
      assert.equal(gallerySize.ok, true);
      await browser.waitUntil(() =>
        browser.execute(
          (width) => Math.abs(innerWidth - width) <= 1,
          galleryWidth,
        ),
      );
      await browser.execute(async () => {
        const main = document.querySelector("main");
        const gallery = document.querySelector(".skin-gallery");
        document.activeElement?.blur();
        main.scrollTop +=
          gallery.getBoundingClientRect().top -
          main.getBoundingClientRect().top -
          16;
        document.querySelector(".app-sidebar-navigation").scrollTop = 0;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      await screenshot("desktop-skins-dark.png");
      await patchSettings({ theme: "light" });
      await settledAppearance({ theme: "light" });
      await screenshot("desktop-skins-light.png");
      await patchSettings({ theme: "dark" });
      await settledAppearance({ theme: "dark" });
      await invoke("set_window_size", {
        width: size.value.width,
        height: size.value.height,
      });
      await browser.waitUntil(() =>
        browser.execute(
          (width) => Math.abs(innerWidth - width) <= 1,
          size.value.width,
        ),
      );
      await browser.execute(() => {
        document.querySelector("main").scrollTop = 180;
      });
      const before = await geometry();
      assert.equal(before.main.y, before.chrome.height);
      assert.equal(before.rootScrollTop, 0);
      for (const menu of await $$(".app-title-menu-trigger")) {
        // 桌面驱动的 element.click 只发 DOM click；菜单同时以键盘入口验证。
        await browser.execute((element) => element.focus(), menu);
        await browser.keys("ArrowDown");
        await $("[role=menu]").waitForDisplayed();
        assert.deepEqual(await geometry(), before);
        await browser.keys("Escape");
        await $("[role=menu]").waitForExist({ reverse: true });
        assert.deepEqual(await geometry(), before);
      }
      await $(".app-title-language").click();
      await $("[role=listbox]").waitForDisplayed();
      assert.deepEqual(await geometry(), before);
      await browser.keys("Escape");
      await language("en");
      assert.deepEqual((await geometry()).main, before.main);
      const aligned = await browser.execute(() => {
        const right = (selector) =>
          document.querySelector(selector).getBoundingClientRect().right;
        return (
          Math.abs(
            right("#settings-appMode .settings-row-control") -
              right("#settings-windowPosition .settings-row-control"),
          ) <= 1
        );
      });
      assert.equal(aligned, true);
      await $(".wallpaper-library").scrollIntoView({ block: "center" });
      await screenshot("desktop-background-controls.png");

      // 静止指针下反复折叠不能激活展开时的 Tooltip 状态。
      await browser.execute(() => {
        document.querySelector("main").scrollTop = 0;
      });
      await $("a[href='#/']").click();
      await $("button[aria-label='Collapse sidebar']").click();
      await browser.waitUntil(
        async () =>
          (await $("#app-sidebar").getAttribute("data-collapsed")) === "true",
      );
      assert.equal((await $$("[data-slot=tooltip-content]")).length, 0);
      await $("button[aria-label='Expand sidebar']").click();
      assert.equal((await $$("[data-slot=tooltip-content]")).length, 0);

      await navigate("/desktop");
      await $("[data-testid=open-secondary-window]").waitForEnabled();
      for (const width of [880, 1120]) {
        const resized = await invoke("set_window_size", { width, height: 740 });
        assert.equal(resized.ok, true);
        await browser.waitUntil(() =>
          browser.execute(
            (expected) => Math.abs(innerWidth - expected) <= 1,
            resized.value.width,
          ),
        );
        for (const language of ["zh", "en"]) {
          await patchSettings({ language, fontSize: "lg", theme: "light" });
          await settledAppearance({ language, fontSize: "lg", theme: "light" });
          const controls = await browser.execute(() =>
            [...document.querySelectorAll(".settings-row-control")].map(
              (element) => {
                const control = element.getBoundingClientRect();
                const row = element
                  .closest(".settings-row")
                  .getBoundingClientRect();
                return {
                  right: control.right,
                  withinRow:
                    control.left >= row.left && control.right <= row.right + 1,
                };
              },
            ),
          );
          assert.equal(controls.length, 3);
          assert.ok(controls.every((control) => control.withinRow));
          assert.ok(
            Math.max(...controls.map((control) => control.right)) -
              Math.min(...controls.map((control) => control.right)) <=
              1,
          );
        }
      }
      await patchSettings({ language: "zh", fontSize: "md" });
      await settledAppearance({ language: "zh", fontSize: "md" });
      await screenshot("desktop-controls.png");
      await navigate("/bridge");
      for (const theme of ["light", "dark"]) {
        await patchSettings({ theme });
        await settledAppearance({ theme });
        for (const language of ["rust", "typescript"]) {
          await $("code[data-language=" + language + "]").waitForDisplayed();
          const colors = await browser.execute((value) => {
            const code = document.querySelector(
              "code[data-language=" + value + "]",
            );
            return {
              plain: getComputedStyle(code).color,
              keyword: getComputedStyle(
                code.querySelector("[data-token=keyword]"),
              ).color,
              string: getComputedStyle(
                code.querySelector("[data-token=string]"),
              ).color,
            };
          }, language);
          assert.notEqual(
            colors.keyword,
            colors.plain,
            language + " keyword in " + theme,
          );
          assert.notEqual(
            colors.string,
            colors.keyword,
            language + " string in " + theme,
          );
        }
        await screenshot("desktop-code-examples-" + theme + ".png");
      }
    } finally {
      await patchSettings(original);
      await settledAppearance({
        language: original.language,
        theme: original.theme,
        background: original.background,
      });
      await invoke("set_window_size", {
        width: originalWindow.width,
        height: originalWindow.height,
      });
    }
  });

  it("imports a real local raster image and synchronizes its native snapshot between windows", async () => {
    const original = (await invoke("load_settings_snapshot")).value.settings;
    const main = await browser.getWindowHandle();
    let secondary;
    try {
      await patchSettings({
        language: "en",
        background: "plain",
        customBackground: null,
        sidebarCollapsed: false,
      });
      await settledAppearance({ language: "en", background: "plain" });
      await navigate("/settings");
      await $("input[type=file]").waitForExist();
      // 由真实 Canvas 生成无用户数据的文件夹具，经同一 file input / React 导入入口处理。
      await browser.execute(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1800;
        canvas.height = 1000;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 1800, 1000);
        gradient.addColorStop(0, "#476d98");
        gradient.addColorStop(1, "#c6d9bf");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([blob], "e2e-background.png", { type: "image/png" }),
        );
        const input = document.querySelector("input[type=file]");
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await browser.waitUntil(
        async () => (await appearance()).background === "custom",
      );
      await browser.waitUntil(() =>
        browser.execute(() => {
          const image = document.querySelector("[data-custom-background]");
          return (
            image?.complete &&
            image.naturalWidth > 0 &&
            image.naturalWidth <= 1600
          );
        }),
      );
      let imported;
      await browser.waitUntil(async () => {
        const snapshot = await invoke("load_settings_snapshot");
        imported = snapshot.value.settings.customBackground;
        return imported?.name === "e2e-background.png";
      });
      assert.ok(imported.dataUrl.length <= 96 * 1024);
      assert.match(imported.dataUrl, /^data:image\/(webp|jpeg);base64,/);
      assert.equal((await invoke("open_secondary_window")).ok, true);
      await browser.waitUntil(
        async () => (await browser.getWindowHandles()).length === 2,
      );
      secondary = (await browser.getWindowHandles()).find(
        (handle) => handle !== main,
      );
      await browser.switchToWindow(secondary);
      await ready("secondary");
      await browser.waitUntil(
        async () => (await appearance()).background === "custom",
      );
      assert.equal(
        await $("[data-custom-background]").getAttribute("src"),
        imported.dataUrl,
      );
      await navigate("/settings");
      await $("button[role=combobox][aria-label='Image fit']").click();
      await $(
        "//*[@role='option'][normalize-space()='Show full image']",
      ).click();
      await browser.waitUntil(async () => {
        const snapshot = await invoke("load_settings_snapshot");
        return snapshot.value.settings.customBackground?.fit === "contain";
      });
      await browser.switchToWindow(main);
      await browser.waitUntil(() =>
        browser.execute(
          () =>
            getComputedStyle(document.querySelector("[data-custom-background]"))
              .objectFit === "contain",
        ),
      );
      const fixture = (await invoke("load_settings_snapshot")).value.settings
        .customBackground;
      writeFileSync(
        join(
          process.env.STARTER_E2E_DATA_ROOT,
          "background-image-fixture.json",
        ),
        JSON.stringify(fixture),
      );
      await $(".wallpaper-library").scrollIntoView({ block: "center" });
      await screenshot("desktop-custom-background.png");
    } finally {
      await browser.switchToWindow(main);
      if (secondary && (await browser.getWindowHandles()).includes(secondary)) {
        await invoke("plugin:window|close", { label: "secondary" });
        await browser.waitUntil(
          async () => (await browser.getWindowHandles()).length === 1,
        );
      }
      await patchSettings(original);
    }
  });
}

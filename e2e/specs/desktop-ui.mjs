import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, $$ } from "@wdio/globals";
import { appearance, invoke, language, navigate, ready } from "../helpers.mjs";
import {
  patchSettings,
  screenshot,
  settledAppearance,
} from "../appearance.mjs";
import { captureReadmePreviews } from "../readme-previews.mjs";

function geometry() {
  return browser.execute(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      main: rect("main"),
      chrome: rect(".app-chrome"),
      rootScrollTop: document.scrollingElement.scrollTop,
    };
  });
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
      await $(".wallpaper-library[aria-busy=false]").waitForExist();
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

  it("captures the native desktop and keeps settings controls aligned", async () => {
    const original = (await invoke("load_settings_snapshot")).value.settings;
    const originalWindow = (await invoke("get_window_geometry")).value;
    try {
      await captureReadmePreviews(originalWindow);
      await browser.execute(() => {
        document.querySelector("main").scrollTop = 180;
      });
      const layout = await geometry();
      assert.equal(layout.main.y, layout.chrome.height);
      assert.equal(layout.rootScrollTop, 0);
      await language("en");
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
      await $("[data-slot=tooltip-content]").waitForExist({ reverse: true });
      assert.equal((await $$("[data-slot=tooltip-content]")).length, 0);
      await $("button[aria-label='Expand sidebar']").click();
      await $("[data-slot=tooltip-content]").waitForExist({ reverse: true });
      assert.equal((await $$("[data-slot=tooltip-content]")).length, 0);

      await navigate("/desktop");
      await $("[data-testid=open-secondary-window]").waitForEnabled();
      for (const width of [880, 1120]) {
        // CI 工作区可能小于预设尺寸，沿用原生服务报告的可用范围。
        const target = {
          width: Math.min(
            originalWindow.maxWidth,
            Math.max(originalWindow.minWidth, width),
          ),
          height: Math.min(
            originalWindow.maxHeight,
            Math.max(originalWindow.minHeight, 740),
          ),
        };
        const resized = await invoke("set_window_size", target);
        assert.equal(resized.ok, true, JSON.stringify(resized));
        // macOS 的原生尺寸事件可能晚于命令返回，等待请求目标而非旧快照。
        await browser.waitUntil(() =>
          browser.execute(
            (expected) => Math.abs(innerWidth - expected) <= 1,
            target.width,
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

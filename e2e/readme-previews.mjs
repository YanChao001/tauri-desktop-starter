import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $ } from "@wdio/globals";
import { patchSettings, screenshot, settledAppearance } from "./appearance.mjs";
import { invoke, navigate } from "./helpers.mjs";

async function settledSettingsViewport(width) {
  // 截图等待实际几何稳定；列数的产品要求由浏览器断点用例独立验收。
  let first;
  let current;
  try {
    await browser.waitUntil(
      async () => {
        const previous = current;
        current = await browser.execute(() => {
          const preset = document.querySelector("[data-window-preset]");
          const grid = preset?.parentElement;
          const containerWidth = document
            .querySelector(".settings-studio")
            .getBoundingClientRect().width;
          const buttons = [...(grid?.children ?? [])].map((element) =>
            element.getBoundingClientRect(),
          );
          return {
            width: innerWidth,
            containerWidth,
            columns: grid
              ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length
              : 0,
            buttons: buttons.length,
            visibleButtons: buttons.filter(
              (rect) => rect.width > 0 && rect.height > 0,
            ).length,
            geometry: buttons
              .map(({ x, y, width, height }) =>
                [x, y, width, height]
                  .map((value) => Math.round(value * 100) / 100)
                  .join(","),
              )
              .join(";"),
            firstRow: buttons.filter(
              (rect) => Math.abs(rect.y - buttons[0].y) < 0.5,
            ).length,
          };
        });
        first ??= current;
        return (
          Math.abs(current.width - width) <= 1 &&
          current.containerWidth > 0 &&
          current.columns > 0 &&
          current.buttons > 0 &&
          current.visibleButtons === current.buttons &&
          current.firstRow === Math.min(current.columns, current.buttons) &&
          JSON.stringify(previous) === JSON.stringify(current)
        );
      },
      {
        interval: 100,
        timeoutMsg: `Settings responsive layout did not settle at ${width}px`,
      },
    );
  } catch (error) {
    writeFileSync(
      join(
        "artifacts",
        "e2e",
        process.env.STARTER_E2E_PHASE,
        "settings-viewport-timeout.json",
      ),
      JSON.stringify({ expectedWidth: width, first, current }, null, 2),
    );
    throw error;
  }
  console.info("Settings viewport settled:", { width, first, current });
}

/** 独立采集和完整桌面验收共用同一组场景；调用方管理隔离进程与设置恢复。 */
export async function captureReadmePreviews(bounds) {
  const target = {
    width: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, 1280)),
    height: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, 840)),
  };
  const size = await invoke("set_window_size", target);
  assert.equal(size.ok, true);
  // 原生命令可能先于窗口尺寸事件返回，等待请求目标而非旧快照。
  await browser.waitUntil(() =>
    browser.execute((width) => Math.abs(innerWidth - width) <= 1, target.width),
  );
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
  await screenshot("desktop-light.png");
  await patchSettings({ theme: "dark" });
  await settledAppearance({ theme: "dark" });
  await screenshot("desktop-dark.png");
  await navigate("/settings");
  await $(".skin-gallery").waitForDisplayed();
  await $(".wallpaper-library[aria-busy=false]").waitForExist();
  const galleryWidth = Math.max(bounds.minWidth, Math.min(1120, target.width));
  const gallerySize = await invoke("set_window_size", {
    width: galleryWidth,
    height: target.height,
  });
  assert.equal(gallerySize.ok, true);
  await browser.waitUntil(() =>
    browser.execute((width) => Math.abs(innerWidth - width) <= 1, galleryWidth),
  );
  await settledSettingsViewport(galleryWidth);
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
  const restored = await invoke("set_window_size", target);
  assert.equal(restored.ok, true);
  await browser.waitUntil(() =>
    browser.execute((width) => Math.abs(innerWidth - width) <= 1, target.width),
  );
  // 设置页会在 resize 后防抖刷新原生尺寸；先等其完成，避免菜单检查拿到旧布局。
  await browser.waitUntil(async () =>
    (await $("#settings-window [aria-live=polite]").getText()).includes(
      `${target.width} × ${target.height}`,
    ),
  );
  await settledAppearance({ theme: "dark" });
  await settledSettingsViewport(target.width);
}

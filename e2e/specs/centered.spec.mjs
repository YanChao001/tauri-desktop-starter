import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browser } from "@wdio/globals";
import {
  ready,
  invoke,
  windowPlacement,
  placeNearWorkAreaCorner,
} from "../helpers.mjs";

const execute = promisify(execFile);

describe("Centered window startup", () => {
  it("centers a restarted main window and a newly created secondary window", async () => {
    await ready();
    assert.equal(
      (await invoke("load_settings_snapshot")).value.settings.windowPosition,
      "center",
    );
    await browser.waitUntil(async () => (await windowPlacement()).centered);
    const geometry = (await invoke("get_window_geometry")).value;
    assert.equal(
      geometry.width,
      Math.min(geometry.maxWidth, Math.max(geometry.minWidth, 1000)),
    );
    assert.equal(
      geometry.height,
      Math.min(geometry.maxHeight, Math.max(geometry.minHeight, 680)),
    );
    const main = await browser.getWindowHandle();
    assert.equal((await invoke("open_secondary_window")).ok, true);
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 2,
    );
    const secondary = (await browser.getWindowHandles()).find(
      (handle) => handle !== main,
    );
    await browser.switchToWindow(secondary);
    await ready("secondary");
    await browser.waitUntil(async () => (await windowPlacement()).centered);
    await browser.switchToWindow(main);
  });

  it("preserves manual movement and repeated activation after centered startup", async () => {
    const moved = await placeNearWorkAreaCorner();
    // 覆盖几何模块的一秒显示器检查周期，确认居中不是持续纠正位置的约束。
    await browser.pause(1200);
    await execute(process.env.STARTER_E2E_BINARY, [], {
      timeout: 7000,
      windowsHide: true,
    });
    const after = (await windowPlacement()).position;
    assert.ok(
      Math.abs(moved.x - after.x) <= 2 && Math.abs(moved.y - after.y) <= 2,
    );
    assert.equal(
      (await invoke("greet", { name: "Position", language: "en" })).ok,
      true,
    );
  });
});
/* global describe, it */

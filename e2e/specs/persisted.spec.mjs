import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $ } from "@wdio/globals";
import {
  appearance,
  invoke,
  ready,
  navigate,
  windowPlacement,
} from "../helpers.mjs";

describe("App process restart", () => {
  it("restores native settings in a new app process with the same isolated user data", async () => {
    await ready();
    await browser.waitUntil(async () => {
      const state = await appearance();
      return (
        state.language === "en" &&
        state.background === "sakura" &&
        state.intensity === "strong"
      );
    });
    assert.deepEqual(await appearance(), {
      language: "en",
      background: "sakura",
      intensity: "strong",
    });
    const settings = await invoke("load_settings_snapshot");
    assert.equal(settings.ok, true);
    assert.equal(settings.value.settings.language, "en");
    assert.equal(settings.value.settings.background, "sakura");
    assert.equal(settings.value.settings.backgroundIntensity, "strong");
    assert.equal(settings.value.settings.windowPosition, "remember");
    const expectedPosition = JSON.parse(
      readFileSync(
        join(
          process.env.STARTER_E2E_DATA_ROOT,
          "window-placement-fixture.json",
        ),
        "utf8",
      ),
    );
    const placement = await windowPlacement();
    assert.ok(
      Math.abs(placement.position.x - expectedPosition.x) <= 2 &&
        Math.abs(placement.position.y - expectedPosition.y) <= 2,
    );
    const geometry = await invoke("get_window_geometry");
    assert.equal(geometry.ok, true);
    assert.equal(
      geometry.value.width,
      Math.min(
        geometry.value.maxWidth,
        Math.max(geometry.value.minWidth, 1000),
      ),
    );
    assert.equal(
      geometry.value.height,
      Math.min(
        geometry.value.maxHeight,
        Math.max(geometry.value.minHeight, 680),
      ),
    );
    assert.equal(
      (await invoke("plugin:window|is_visible", { label: "main" })).value,
      true,
    );
    const notes = await invoke("list_notes", { search: "E2E persisted note" });
    assert.equal(notes.ok, true);
    assert.equal(notes.value.length, 1);
    assert.equal(notes.value[0].title, "E2E persisted note");
    assert.equal(notes.value[0].body, "Saved before app process restart");
    await browser.saveScreenshot(
      "artifacts/e2e/persisted/restarted-window.png",
    );
  });

  it("saves centered startup without moving an existing window", async () => {
    await navigate("/settings");
    const before = (await windowPlacement()).position;
    await $("[data-window-position=center]").click();
    await browser.waitUntil(
      async () =>
        (await invoke("load_settings_snapshot")).value.settings
          ?.windowPosition === "center",
    );
    assert.deepEqual((await windowPlacement()).position, before);
    assert.equal(
      (await invoke("plugin:window-state|save_window_state", { flags: 2 })).ok,
      true,
    );
  });
});
/* global describe, it */

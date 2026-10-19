import assert from "node:assert/strict";
import { browser } from "@wdio/globals";
import { appearance, invoke, ready } from "../helpers.mjs";

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
});
/* global describe, it */

import assert from "node:assert/strict";
import { join } from "node:path";
import { browser } from "@wdio/globals";
import { invoke } from "./helpers.mjs";

export async function patchSettings(patch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await invoke("load_settings_snapshot");
    assert.equal(snapshot.ok, true);
    const result = await invoke("save_settings_snapshot", {
      settings: { ...snapshot.value.settings, ...patch, schemaVersion: 6 },
      expectedRevision: snapshot.value.revision,
    });
    if (result.ok) return result.value;
    assert.equal(result.failure.code, "SETTINGS_CONFLICT");
  }
  throw new Error("Native preferences did not settle");
}

export async function settledAppearance(expected) {
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

export async function screenshot(name) {
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
  await browser.saveScreenshot(
    join("artifacts", "e2e", process.env.STARTER_E2E_PHASE, name),
  );
}

import { browser, $ } from "@wdio/globals";

export async function ready(label = "main") {
  await $("#root main").waitForExist();
  await browser.waitUntil(
    () => browser.execute(() => Boolean(globalThis.__TAURI_INTERNALS__)),
    { timeoutMsg: "Tauri IPC did not initialize" },
  );
  await browser.waitUntil(
    async () =>
      (await invoke("plugin:window|is_visible", { label })).value === true,
  );
}

/** W3C execute 调用真正的原生桥；这里没有 mock 或 browser-only interceptor。 */
export function invoke(command, args = {}) {
  return browser.execute(
    async (name, payload) => {
      try {
        return {
          ok: true,
          value: await globalThis.__TAURI_INTERNALS__.invoke(name, payload),
        };
      } catch (error) {
        return { ok: false, failure: error };
      }
    },
    command,
    args,
  );
}

export async function navigate(path) {
  const link = await $(`a[href="#${path}"]`);
  await link.click();
  await browser.waitUntil(() =>
    browser.execute(
      (expected) => globalThis.location.hash === `#${expected}`,
      path,
    ),
  );
}

export async function language(locale) {
  const trigger = await $("button[aria-description][role=combobox]");
  await trigger.click();
  await $(`[role=option][lang="${locale === "en" ? "en" : "zh-CN"}"]`).click();
  await browser.waitUntil(() =>
    browser.execute(
      (expected) => globalThis.document.documentElement.lang === expected,
      locale === "en" ? "en" : "zh-CN",
    ),
  );
}

export function appearance() {
  return browser.execute(() => ({
    language: globalThis.document.documentElement.lang,
    background: globalThis.document.documentElement.dataset.background,
    intensity: globalThis.document.documentElement.dataset.backgroundIntensity,
  }));
}

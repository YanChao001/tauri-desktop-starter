import { afterEach, describe, expect, it } from "vitest";

import { getAppInfo, invokeGreet, isTauri, revealWindow } from "./tauri";

describe("isTauri", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("jsdom 里默认是浏览器预览模式", () => {
    expect(isTauri()).toBe(false);
  });

  it("存在 __TAURI_INTERNALS__ 时判定为 Tauri 环境", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    expect(isTauri()).toBe(true);
  });
});

describe("浏览器预览模式的守卫", () => {
  // jsdom 不是 Tauri 环境，invokeGreet / getAppInfo 应当在触碰 IPC 前就拦下
  it("invokeGreet 给出可操作的提示，而不是晦涩的 IPC 报错", async () => {
    await expect(invokeGreet("超哥")).rejects.toThrow("pnpm app:dev");
  });

  it("getAppInfo 同样拒绝", async () => {
    await expect(getAppInfo()).rejects.toThrow("浏览器预览模式");
  });

  it("revealWindow 静默返回，不抛错", async () => {
    await expect(revealWindow()).resolves.toBeUndefined();
  });
});

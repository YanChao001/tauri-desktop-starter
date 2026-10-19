import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  getAppInfo,
  invokeGreet,
  isTauri,
  openExternal,
  revealWindow,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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

describe("openExternal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("noopener 返回 null 仍算成功，避免浏览器已打开却提示失败", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(
      openExternal("https://example.com/docs"),
    ).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/example",
  ])("拒绝非网页协议 %s", async (url) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openExternal(url)).rejects.toThrow("http(s)");
    expect(open).not.toHaveBeenCalled();
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

describe("greet 语言参数", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.resetAllMocks();
  });

  it("将当前语言传给 Rust，并保留省略语言时的中文默认值", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    vi.mocked(invoke).mockResolvedValue("greeting");
    await expect(invokeGreet("Ada", "en")).resolves.toBe("greeting");
    expect(invoke).toHaveBeenLastCalledWith("greet", {
      name: "Ada",
      language: "en",
    });
    await invokeGreet("世界");
    expect(invoke).toHaveBeenLastCalledWith("greet", {
      name: "世界",
      language: "zh",
    });
  });

  it("英文浏览器预览给出同语言的启动提示", async () => {
    await expect(invokeGreet("Ada", "en")).rejects.toThrow(
      "Start the desktop app with pnpm app:dev",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

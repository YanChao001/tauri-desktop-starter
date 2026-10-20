import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  getAppInfo,
  getWindowGeometry,
  invokeGreet,
  isTauri,
  openExternal,
  revealWindow,
  resetWindowGeometry,
  setWindowSize,
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

describe("窗口几何命令", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.resetAllMocks();
  });

  it("浏览器模式在调用 IPC 前拒绝读取、修改和重置窗口尺寸", async () => {
    await expect(getWindowGeometry()).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    await expect(setWindowSize(1000, 680)).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    await expect(resetWindowGeometry()).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("尺寸传给原生命令，重置位置默认关闭并可显式启用", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    vi.mocked(invoke).mockResolvedValue({ width: 1000, height: 680 });
    await expect(setWindowSize(1000, 680)).resolves.toEqual({
      width: 1000,
      height: 680,
    });
    expect(invoke).toHaveBeenLastCalledWith("set_window_size", {
      width: 1000,
      height: 680,
    });
    await resetWindowGeometry();
    expect(invoke).toHaveBeenLastCalledWith("reset_window_geometry", {
      center: false,
    });
    await resetWindowGeometry(true);
    expect(invoke).toHaveBeenLastCalledWith("reset_window_geometry", {
      center: true,
    });
  });
});

describe("首帧显示握手", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("首帧通过原生握手显示窗口，记录就绪状态后才能响应重复启动", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(revealWindow()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("complete_frontend_startup");
  });

  it("握手失败保留错误记录并交给原生超时显示，不产生未处理拒绝", async () => {
    vi.mocked(invoke).mockRejectedValue({
      code: "WINDOW_ERROR",
      message: "Cannot reveal ready window",
      retryable: true,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(revealWindow()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "显示窗口失败",
      expect.objectContaining({ message: "Cannot reveal ready window" }),
    );
  });
});

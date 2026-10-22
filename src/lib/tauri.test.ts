import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  getAppInfo,
  getWindowGeometry,
  invokeGreet,
  onLifecycleRequest,
  onLifecycleFinished,
  openExternal,
  revealWindow,
  resetWindowGeometry,
  setWindowSize,
  isWindowFullscreen,
  setWindowFullscreen,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const events = vi.hoisted(() => ({
  label: "main",
  fullscreen: vi.fn(),
  setFullscreen: vi.fn(),
  listen:
    vi.fn<
      (
        event: string,
        handler: (event: { payload: unknown }) => void,
        options: unknown,
      ) => Promise<() => void>
    >(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: events.label,
    isFullscreen: events.fullscreen,
    setFullscreen: events.setFullscreen,
  }),
}));

describe("全屏门面", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    vi.clearAllMocks();
  });
  it("原生模式查询并设置当前窗口，错误保持可见", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    events.fullscreen.mockResolvedValue(true);
    expect(await isWindowFullscreen()).toBe(true);
    events.setFullscreen.mockResolvedValue(undefined);
    await setWindowFullscreen(false);
    expect(events.setFullscreen).toHaveBeenCalledWith(false);
    events.setFullscreen.mockRejectedValueOnce(new Error("denied"));
    await expect(setWindowFullscreen(true)).rejects.toThrow("denied");
  });
  it("浏览器进入与退出使用真实 API，未支持时不伪造全屏状态", async () => {
    expect(await isWindowFullscreen()).toBe(false);
    const enter = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: enter,
      configurable: true,
    });
    Object.defineProperty(document, "exitFullscreen", {
      value: exit,
      configurable: true,
    });
    await setWindowFullscreen(true);
    expect(enter).toHaveBeenCalledOnce();
    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
    });
    expect(await isWindowFullscreen()).toBe(true);
    await setWindowFullscreen(false);
    expect(exit).toHaveBeenCalledOnce();
    expect(events.setFullscreen).not.toHaveBeenCalled();
  });
});

describe("当前窗口事件契约", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.clearAllMocks();
  });

  it.each(["main", "secondary"])(
    "%s 订阅显式限制当前窗口目标并保留取消函数",
    async (label) => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      events.label = label;
      const stop = vi.fn();
      events.listen.mockResolvedValue(stop);
      const handler = vi.fn();
      expect(await onLifecycleRequest(handler)).toBe(stop);
      expect(events.listen).toHaveBeenCalledExactlyOnceWith(
        "app://lifecycle-request",
        expect.any(Function),
        {
          target: { kind: "WebviewWindow", label },
        },
      );
      const request = { id: 1, action: "quit", windows: ["main", "secondary"] };
      events.listen.mock.calls[0]![1]({ payload: request });
      expect(handler).toHaveBeenCalledExactlyOnceWith(request);
    },
  );

  it("广播事件仍使用当前窗口目标并原样转发已接收的payload", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    events.label = "secondary";
    events.listen.mockResolvedValue(vi.fn());
    const handler = vi.fn();
    await onLifecycleFinished(handler);
    expect(events.listen).toHaveBeenCalledExactlyOnceWith(
      "app://lifecycle-finished",
      expect.any(Function),
      {
        target: { kind: "WebviewWindow", label: "secondary" },
      },
    );
    events.listen.mock.calls[0]![1]({ payload: 7 });
    expect(handler).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("浏览器模式不调用原生事件API", async () => {
    const stop = await onLifecycleRequest(vi.fn());
    expect(events.listen).not.toHaveBeenCalled();
    expect(stop()).toBeUndefined();
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

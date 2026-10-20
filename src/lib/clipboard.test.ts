import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(async () => {}),
}));

/**
 * jsdom 没有实现 Clipboard API 与 execCommand。
 * clipboard 用 defineProperty 注入（own property，可删），
 * execCommand 直接覆盖 document 上的引用，结束再还回去。
 */
function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

const originalExecCommand = document.execCommand;

describe("copyText", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.mocked(writeText).mockReset().mockResolvedValue(undefined);
    Reflect.deleteProperty(navigator, "clipboard");
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("桌面直接使用官方原生剪贴板，不依赖 WebView 权限", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    const browserWrite = vi.fn();
    stubClipboard({ writeText: browserWrite });
    await copyText("native copy");
    expect(writeText).toHaveBeenCalledWith("native copy");
    expect(browserWrite).not.toHaveBeenCalled();
  });

  it("原生剪贴板失败时保留错误，避免降级路径掩盖失败", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    vi.mocked(writeText).mockRejectedValueOnce(
      new Error("System clipboard locked"),
    );
    const execCommand = vi.fn();
    document.execCommand = execCommand;
    await expect(copyText("native copy")).rejects.toThrow(
      "System clipboard locked",
    );
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("优先使用异步 Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("Clipboard API 不可用时回退到 execCommand", async () => {
    stubClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await copyText("hello");

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("writeText 抛错时同样降级，而不是把失败抛给调用方", async () => {
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await copyText("hello");

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("降级也失败时抛错，且不留残留的 textarea", async () => {
    stubClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(copyText("hello")).rejects.toThrow("不支持复制");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it.each([true, false])(
    "降级复制成功状态 %s 后恢复输入框焦点和选择范围",
    async (copied) => {
      stubClipboard(undefined);
      document.execCommand = vi.fn().mockReturnValue(copied);
      const input = document.createElement("input");
      input.value = "original selection";
      document.body.append(input);
      input.focus();
      input.setSelectionRange(2, 8, "backward");

      if (copied) await copyText("hello");
      else await expect(copyText("hello")).rejects.toThrow("不支持复制");

      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(8);
      expect(input.selectionDirection).toBe("backward");
    },
  );
});

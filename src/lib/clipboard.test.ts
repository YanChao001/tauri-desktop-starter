import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

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
    Reflect.deleteProperty(navigator, "clipboard");
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
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
});

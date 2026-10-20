// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri, recordFrontendError } from "./tauri";

vi.mock("./tauri", () => ({
  isTauri: vi.fn(() => true),
  recordFrontendError: vi.fn().mockResolvedValue(undefined),
}));

describe("前端错误记录", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
  });

  it("在写入日志前去掉URL凭据、查询参数、令牌及用户目录", async () => {
    const { reportClientError } = await import("./report-error");
    const error = new Error(
      "https://alice:pass@example.com/api?code=oauth#private token=secret",
    );
    error.stack =
      "at C:\\Users\\Alice\\private\\app.ts:1\nat /home/alice/app.ts:2";
    reportClientError(error);
    const record = vi.mocked(recordFrontendError).mock.calls[0]![0];
    expect(record.message).toBe("https://example.com/api token=[redacted]");
    expect(record.stack).not.toMatch(/Alice|alice|private/);
  });

  it("中文和Emoji错误按UTF8字节限制截断，不拆开字符", async () => {
    const { reportClientError } = await import("./report-error");
    const error = new Error("错🌸".repeat(3000));
    error.stack = "错🌸".repeat(5000);
    reportClientError(error, error.stack);
    const record = vi.mocked(recordFrontendError).mock.calls[0]![0];
    expect(new TextEncoder().encode(record.message).length).toBeLessThanOrEqual(
      4000,
    );
    expect(new TextEncoder().encode(record.stack).length).toBeLessThanOrEqual(
      8000,
    );
    expect(
      new TextEncoder().encode(record.componentStack).length,
    ).toBeLessThanOrEqual(8000);
    expect(JSON.stringify(record)).not.toContain("�");
  });

  it("浏览器不发IPC，原生每分钟最多20条，记录自身失败不递归", async () => {
    const { reportClientError } = await import("./report-error");
    vi.mocked(isTauri).mockReturnValue(false);
    reportClientError(new Error("browser"));
    expect(recordFrontendError).not.toHaveBeenCalled();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(recordFrontendError).mockRejectedValue(new Error("disk full"));
    for (let i = 0; i < 25; i++) reportClientError(new Error("failure"));
    await Promise.resolve();
    expect(recordFrontendError).toHaveBeenCalledTimes(20);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    reportClientError(new Error("new minute"));
    expect(recordFrontendError).toHaveBeenCalledTimes(21);
    now.mockRestore();
  });
});

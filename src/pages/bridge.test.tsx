import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { invokeGreet, isTauri } from "@/lib/tauri";
import { LOCALES } from "@/i18n/registry";
import { createTranslator } from "@/i18n/translate";
import Bridge from "./bridge";

const locale = vi.hoisted(() => ({ current: "en" as "en" | "zh" }));
const messages = () => LOCALES[locale.current].messages;

vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => true),
  invokeGreet: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({
    language: locale.current,
    t: createTranslator(messages()),
  }),
}));

describe("Bridge 命令调用", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    locale.current = "en";
  });
  afterEach(cleanup);

  it("前端调用示例明确使用 TypeScript 高亮", async () => {
    const { container } = render(<Bridge />);
    const snippet = container.querySelector('code[data-language="typescript"]');
    expect(snippet).toHaveTextContent('invokeGreet("Ada", language)');
    await waitFor(() =>
      expect(
        snippet?.querySelector('[data-token="keyword"]'),
      ).toHaveTextContent("export"),
    );
    expect(snippet?.querySelector('[data-token="function"]')).toHaveTextContent(
      "invokeGreet",
    );
  });

  it("按钮和回车在请求期间只提交一次，完成后可以再次提交", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let resolve!: (message: string) => void;
    vi.mocked(invokeGreet).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    render(
      <StrictMode>
        <Bridge />
      </StrictMode>,
    );
    const input = screen.getByLabelText(messages()["bridge.name"]);
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "Ada" } });
    fireEvent.click(
      screen.getByRole("button", { name: messages()["bridge.call"] }),
    );
    fireEvent.submit(form);
    expect(invokeGreet).toHaveBeenCalledExactlyOnceWith("Ada", "en");
    expect(form).toHaveAttribute("aria-busy", "true");

    await act(async () => resolve("Hello, Ada"));
    expect(screen.getByRole("status")).toHaveTextContent("Hello, Ada");
    expect(form).toHaveAttribute("aria-busy", "false");
    fireEvent.submit(form);
    expect(invokeGreet).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)(
    "切换语言后忽略旧语言请求的 %s 结果和通知，并恢复可提交状态",
    async (outcome) => {
      vi.mocked(isTauri).mockReturnValue(true);
      let resolve!: (message: string) => void;
      let reject!: (reason: Error) => void;
      vi.mocked(invokeGreet).mockImplementation(
        () =>
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      );
      const { rerender } = render(<Bridge />);
      fireEvent.click(
        screen.getByRole("button", { name: messages()["bridge.call"] }),
      );
      locale.current = "zh";
      rerender(<Bridge />);
      await act(async () => {
        if (outcome === "resolve") resolve("Old English result");
        else reject(new Error("Old English error"));
      });
      expect(screen.getByRole("status")).toHaveTextContent(
        messages()["bridge.notCalled"],
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: messages()["bridge.call"] }),
      ).toBeEnabled();
    },
  );

  it("切换语言后不在新语言页面显示之前的示例回复", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invokeGreet).mockResolvedValue("English greeting");
    const { rerender } = render(<Bridge />);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: messages()["bridge.call"] }),
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("English greeting");
    locale.current = "zh";
    rerender(<Bridge />);
    expect(screen.getByRole("status")).toHaveTextContent(
      messages()["bridge.notCalled"],
    );
  });

  it.each(["resolve", "reject"] as const)(
    "离开页面后忽略未完成请求的 %s 结果和通知",
    async (outcome) => {
      vi.mocked(isTauri).mockReturnValue(true);
      let resolve!: (message: string) => void;
      let reject!: (reason: Error) => void;
      vi.mocked(invokeGreet).mockImplementation(
        () =>
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      );
      const { unmount } = render(<Bridge />);
      fireEvent.click(
        screen.getByRole("button", { name: messages()["bridge.call"] }),
      );
      unmount();
      await act(async () => {
        if (outcome === "resolve") resolve("late result");
        else reject(new Error("late error"));
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("浏览器预览给出提示并允许重试", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<Bridge />);
    const button = screen.getByRole("button", {
      name: messages()["bridge.call"],
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(invokeGreet).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  it.each([
    ["en", new Error("invalid name"), "Operation failed: invalid name"],
    ["zh", new Error("invalid name"), "操作失败：invalid name"],
    [
      "en",
      { code: "NAME_REQUIRED", message: "internal detail" },
      LOCALES.en.messages["errors.VALIDATION"],
    ],
    [
      "zh",
      { code: "NAME_REQUIRED", message: "internal detail" },
      LOCALES.zh.messages["errors.VALIDATION"],
    ],
  ] as const)(
    "%s 调用失败使用通用错误提示、保留输入和上次结果并允许重试",
    async (language, error, expected) => {
      locale.current = language;
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(invokeGreet)
        .mockResolvedValueOnce("Hello, Ada")
        .mockRejectedValue(error);
      render(<Bridge />);
      const input = screen.getByLabelText(messages()["bridge.name"]);
      fireEvent.change(input, { target: { value: "Ada" } });
      const button = screen.getByRole("button", {
        name: messages()["bridge.call"],
      });
      await act(async () => fireEvent.click(button));
      await act(async () => fireEvent.click(button));
      expect(screen.getByRole("status")).toHaveTextContent("Hello, Ada");
      expect(input).toHaveValue("Ada");
      expect(screen.queryByText(expected)).not.toBeInTheDocument();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(expected);
      expect(button).toBeEnabled();
      await act(async () => fireEvent.click(button));
      expect(invokeGreet).toHaveBeenCalledTimes(3);
    },
  );

  it("输入法确认候选词的回车不会触发表单提交", () => {
    render(<Bridge />);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(screen.getByLabelText(messages()["bridge.name"]), event);
    expect(event.defaultPrevented).toBe(true);
    expect(invokeGreet).not.toHaveBeenCalled();
  });
});

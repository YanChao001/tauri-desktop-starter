import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { DemoWorkerOutput } from "@/lib/generated/bindings";
import { SidecarPanel, WebSocketPanel } from "./realtime-panels";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  websocketConnect: vi.fn(),
  runDemoSidecar: vi.fn(),
}));
const locale = vi.hoisted(() => ({ language: "en" as "en" | "zh" }));
vi.mock("@/lib/tauri", () => native);
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const { zhCN } = await import("@/i18n/zh-CN");
  const translators = { en: createTranslator(en), zh: createTranslator(zhCN) };
  return {
    useI18n: () => ({
      language: locale.language,
      t: translators[locale.language],
    }),
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  native.isTauri.mockReturnValue(false);
  locale.language = "en";
});

it("展示普通输出并将原始记录默认折叠，保留文本转义与JSON高亮", async () => {
  native.isTauri.mockReturnValue(true);
  const result: DemoWorkerOutput = {
    stdout: "<script>hello</script>",
    stderr: "",
    exitCode: 0,
  };
  native.runDemoSidecar.mockResolvedValue(result);
  const { container } = render(<SidecarPanel />);
  expect(screen.getByText("Not run yet")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Convert to uppercase" }));
  await waitFor(() =>
    expect(
      container.querySelector('code[data-language="json"]'),
    ).not.toBeNull(),
  );
  const code = container.querySelector('code[data-language="json"]');
  expect(
    screen.getByText("<script>hello</script>", { exact: true }),
  ).toBeVisible();
  expect(code).not.toBeVisible();
  fireEvent.click(screen.getByText("Detailed record", { exact: true }));
  expect(code).toBeVisible();
  expect(code?.textContent).toBe(JSON.stringify(result, null, 2));
  expect(code?.querySelector('[data-token="property"]')).toHaveTextContent(
    '"stdout"',
  );
  expect(code?.querySelector('[data-token="string"]')).toHaveTextContent(
    "<script>hello</script>",
  );
  expect(code?.querySelector('[data-token="number"]')).toHaveTextContent("0");
  expect(container.querySelector("script")).toBeNull();
});

it("把文字转换结果显示为易读字段，失败状态与错误不藏进详细记录", async () => {
  native.isTauri.mockReturnValue(true);
  native.runDemoSidecar
    .mockResolvedValueOnce({
      stdout: JSON.stringify({
        input: "hello中",
        uppercase: "HELLO中",
        characters: 6,
      }),
      stderr: "",
      exitCode: 0,
    })
    .mockResolvedValueOnce({
      stdout: "partial output",
      stderr: "Could not finish",
      exitCode: 2,
    });
  render(<SidecarPanel />);
  const run = screen.getByRole("button", { name: "Convert to uppercase" });
  fireEvent.click(run);
  expect(await screen.findByText("HELLO中", { exact: true })).toBeVisible();
  expect(screen.getByText("hello中", { exact: true })).toBeVisible();
  expect(screen.getByText("Character count")).toBeVisible();
  expect(screen.getByText("6", { exact: true })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Completed");
  fireEvent.click(run);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Did not complete (exit status: 2)",
  );
  expect(screen.getByText("Could not finish", { exact: true })).toBeVisible();
  expect(screen.getByText("partial output", { exact: true })).toBeVisible();
  expect(
    screen.getByText("Detailed record", { exact: true }).closest("details"),
  ).not.toHaveAttribute("open");
});

it("worker 输入无效时保留字段错误关联并阻止运行", () => {
  native.isTauri.mockReturnValue(true);
  render(<SidecarPanel />);
  const input = screen.getByLabelText("Text to convert (up to 1000 bytes)");
  const run = screen.getByRole("button", { name: "Convert to uppercase" });
  fireEvent.change(input, { target: { value: " " } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter text no larger than 1000 bytes.",
  );
  expect(input).toHaveAccessibleDescription(
    "Enter text no larger than 1000 bytes.",
  );
  expect(run).toBeDisabled();
  fireEvent.click(run);
  expect(native.runDemoSidecar).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "valid input" } });
  expect(input).not.toHaveAttribute("aria-describedby");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(run).toBeEnabled();
});

it("connects, echoes and disconnects locally without opening a WebSocket", async () => {
  render(<WebSocketPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(await screen.findByText("Connected")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Message content"), {
    target: { value: "local hello" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Received: local hello")).toBeVisible();
  expect(native.websocketConnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

it("closes a late external connection after the user has disconnected", async () => {
  let resolveConnection: (handle: {
    send: () => Promise<void>;
    close: () => Promise<void>;
  }) => void = () => {};
  native.websocketConnect.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveConnection = resolve;
      }),
  );
  const connection = {
    send: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  render(<WebSocketPanel />);
  fireEvent.keyDown(screen.getByLabelText("Request source"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "Online test" }));
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(screen.getByRole("status")).toHaveTextContent("Connecting");
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await act(async () => {
    resolveConnection(connection);
  });
  await waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

it("reports an external connection failure and allows another attempt", async () => {
  native.websocketConnect.mockRejectedValue(
    new Error("Remote service unavailable"),
  );
  render(<WebSocketPanel />);
  fireEvent.keyDown(screen.getByLabelText("Request source"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "Online test" }));
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Cannot connect to the message test service. Retry or use the local test.",
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
});

it.each([
  ["WEBSOCKET_TIMEOUT", "连接超时，请重试或使用本地测试。"],
  ["WEBSOCKET_CONNECTION", "无法连接消息测试服务，请重试或使用本地测试。"],
  ["WEBSOCKET_ENDPOINT", "请选择允许的消息测试服务。"],
])("translates %s into a Chinese connection error", async (code, message) => {
  locale.language = "zh";
  native.websocketConnect.mockRejectedValueOnce({
    code,
    message: "Raw transport diagnostics remain out of user-facing text",
  });
  render(<WebSocketPanel />);
  fireEvent.keyDown(screen.getByLabelText("请求来源"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "联网测试" }));
  fireEvent.click(screen.getByRole("button", { name: "连接" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
  expect(screen.getByRole("status")).toHaveTextContent("未连接");
  expect(screen.getByRole("button", { name: "连接" })).toBeEnabled();
});

it("translates a send failure and retains the unsent message", async () => {
  locale.language = "zh";
  native.websocketConnect.mockResolvedValueOnce({
    send: vi.fn().mockRejectedValueOnce({ code: "WEBSOCKET_SEND" }),
    close: vi.fn().mockResolvedValue(undefined),
  });
  render(<WebSocketPanel />);
  fireEvent.keyDown(screen.getByLabelText("请求来源"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "联网测试" }));
  fireEvent.click(screen.getByRole("button", { name: "连接" }));
  await screen.findByText("已连接", { exact: true });
  const input = screen.getByLabelText("消息内容");
  fireEvent.change(input, { target: { value: "保留待重试内容" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "消息未发送，请检查连接后重试。每条消息不能超过 1000 字。",
    ),
  );
  expect(input).toHaveValue("保留待重试内容");
});

it("worker 失败只弹消息并保留上次输出和当前输入", async () => {
  native.isTauri.mockReturnValue(true);
  native.runDemoSidecar
    .mockResolvedValueOnce({
      stdout: "previous result",
      stderr: "",
      exitCode: 0,
    })
    .mockRejectedValueOnce(new Error("Worker could not start"));
  render(<SidecarPanel />);
  const run = screen.getByRole("button", { name: "Convert to uppercase" });
  fireEvent.click(run);
  await screen.findByText("previous result", { exact: true });
  const input = screen.getByLabelText("Text to convert (up to 1000 bytes)");
  fireEvent.change(input, { target: { value: "retry input" } });
  fireEvent.click(run);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Operation failed: Worker could not start",
    ),
  );
  expect(input).toHaveValue("retry input");
  expect(screen.getByText("previous result", { exact: true })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("离开页面后晚到的 worker 失败不弹出旧页面消息", async () => {
  let rejectRun: (reason: Error) => void = () => {};
  native.isTauri.mockReturnValue(true);
  native.runDemoSidecar.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRun = reject;
      }),
  );
  const { unmount } = render(<SidecarPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Convert to uppercase" }));
  unmount();
  await act(async () => {
    rejectRun(new Error("Late worker failure"));
  });
  expect(toast.error).not.toHaveBeenCalled();
});

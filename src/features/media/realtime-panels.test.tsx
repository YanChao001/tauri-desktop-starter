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
vi.mock("@/lib/tauri", () => native);
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ language: "en", t }) };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  native.isTauri.mockReturnValue(false);
});

it("后台程序输出按 JSON 高亮，未运行提示保留纯文本", async () => {
  native.isTauri.mockReturnValue(true);
  const result: DemoWorkerOutput = {
    stdout: "<script>hello</script>",
    stderr: "",
    exitCode: 0,
  };
  native.runDemoSidecar.mockResolvedValue(result);
  const { container } = render(<SidecarPanel />);
  expect(
    container.querySelector('code[data-language="text"]'),
  ).toHaveTextContent("Not run yet");
  fireEvent.click(
    screen.getByRole("button", { name: "Run controlled worker" }),
  );
  await waitFor(() =>
    expect(
      container.querySelector('code[data-language="json"]'),
    ).not.toBeNull(),
  );
  const code = container.querySelector('code[data-language="json"]');
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
  fireEvent.click(screen.getByRole("option", { name: "External WSS" }));
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
  fireEvent.click(screen.getByRole("option", { name: "External WSS" }));
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Operation failed: Remote service unavailable",
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
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
  const run = screen.getByRole("button", { name: "Run controlled worker" });
  fireEvent.click(run);
  await screen.findByText(/previous result/);
  const input = screen.getByLabelText("Worker input (up to 1000 UTF-8 bytes)");
  fireEvent.change(input, { target: { value: "retry input" } });
  fireEvent.click(run);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Operation failed: Worker could not start",
    ),
  );
  expect(input).toHaveValue("retry input");
  expect(screen.getByText(/previous result/)).toBeVisible();
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
  fireEvent.click(
    screen.getByRole("button", { name: "Run controlled worker" }),
  );
  unmount();
  await act(async () => {
    rejectRun(new Error("Late worker failure"));
  });
  expect(toast.error).not.toHaveBeenCalled();
});

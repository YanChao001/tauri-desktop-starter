import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DemoWorkerOutput } from "@/lib/generated/bindings";
import { SidecarPanel, WebSocketPanel } from "./realtime-panels";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  websocketConnect: vi.fn(),
  runDemoSidecar: vi.fn(),
}));
vi.mock("@/lib/tauri", () => native);
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
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Remote service unavailable",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WebSocketPanel } from "./realtime-panels";

const native = vi.hoisted(() => ({
  websocketConnect: vi.fn(),
  runDemoSidecar: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({ ...native, isTauri: () => false }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ language: "en", t }) };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
  fireEvent.change(screen.getByLabelText("Request source"), {
    target: { value: "wss" },
  });
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
  fireEvent.change(screen.getByLabelText("Request source"), {
    target: { value: "wss" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Remote service unavailable",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
});

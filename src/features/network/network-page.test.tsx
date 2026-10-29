import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import Network from "@/pages/network";
import { en } from "@/i18n/en";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  nativeHttpRequest: vi.fn(),
  setDemoCredential: vi.fn(),
  getDemoCredential: vi.fn(),
  deleteDemoCredential: vi.fn(),
}));
vi.mock("@/lib/tauri", () => native);
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}));
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

it.each(["", "99", "10001", "100.5"])(
  "explains an invalid timeout (%s) next to the field before requests are disabled",
  (value) => {
    render(<Network />);
    const timeout = screen.getByLabelText("Timeout (milliseconds)");
    fireEvent.change(timeout, { target: { value } });
    expect(timeout).toHaveAttribute("aria-invalid", "true");
    expect(timeout).toHaveAccessibleDescription(
      "Enter an integer from 100–10000.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an integer from 100–10000.",
    );
    expect(screen.getByRole("button", { name: "Get content" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send content" })).toBeDisabled();
    fireEvent.change(timeout, { target: { value: "2000" } });
    expect(timeout).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get content" })).toBeEnabled();
  },
);

it("reads cached fixture data offline and never calls the native transport", async () => {
  render(<Network />);
  fireEvent.click(screen.getByRole("button", { name: "Get content" }));
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Returned content" }),
    ).toHaveTextContent('"source": "fixture"'),
  );
  fireEvent.click(screen.getByLabelText("Simulate offline"));
  expect(screen.getByRole("button", { name: "Get content" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "View or refresh result" }),
  );
  expect(toast.info).toHaveBeenCalledWith(en["labs.network.cacheOffline"]);
  expect(native.nativeHttpRequest).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save securely" })).toBeDisabled();
});

it("cancels a pending fixture without replacing its response with a success", async () => {
  render(<Network />);
  fireEvent.click(screen.getByRole("button", { name: "Get content" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(toast.info).toHaveBeenCalledWith(
    "Request cancelled. The last result was retained.",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Get content" })).toBeEnabled(),
  );
  expect(
    screen.getByRole("region", { name: "Returned content" }),
  ).toHaveTextContent("null");
  expect(toast.error).not.toHaveBeenCalled();
});

it("成功的 POST 不继续显示先前 GET 的错误与重试次数", async () => {
  native.isTauri.mockReturnValue(true);
  native.nativeHttpRequest
    .mockResolvedValueOnce({ status: 403, headers: {}, body: "" })
    .mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({
        method: "POST",
        url: "https://httpbin.org/anything",
        json: { message: "hello" },
      }),
    });
  render(<Network />);
  fireEvent.keyDown(screen.getByLabelText("Request source"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "Online test" }));
  fireEvent.click(screen.getByRole("button", { name: "Get content" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send content" }));
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Returned content" }),
    ).toHaveTextContent('"method": "POST"'),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Current failure count:/)).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledOnce();
});

it("POST 失败只弹消息并保留输入和已有响应", async () => {
  native.isTauri.mockReturnValue(true);
  native.nativeHttpRequest
    .mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({
        method: "GET",
        url: "https://httpbin.org/anything",
      }),
    })
    .mockResolvedValueOnce({ status: 403, headers: {}, body: "" });
  render(<Network />);
  fireEvent.keyDown(screen.getByLabelText("Request source"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "Online test" }));
  fireEvent.click(screen.getByRole("button", { name: "Get content" }));
  const response = screen.getByRole("region", { name: "Returned content" });
  await waitFor(() => expect(response).toHaveTextContent('"method": "GET"'));
  fireEvent.change(screen.getByLabelText("Content to send"), {
    target: { value: "keep this input" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send content" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Content to send")).toHaveValue(
    "keep this input",
  );
  expect(response).toHaveTextContent('"method": "GET"');
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Network from "@/pages/network";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  nativeHttpRequest: vi.fn(),
  setDemoCredential: vi.fn(),
  getDemoCredential: vi.fn(),
  deleteDemoCredential: vi.fn(),
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

it("reads cached fixture data offline and never calls the native transport", async () => {
  render(<Network />);
  fireEvent.click(screen.getByRole("button", { name: "Run GET" }));
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Validated response" }),
    ).toHaveTextContent('"source": "fixture"'),
  );
  fireEvent.click(screen.getByLabelText("Simulate offline"));
  expect(screen.getByRole("button", { name: "Run GET" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Read cache / fetch" }));
  expect(
    await screen.findByText(
      "Read the last cached response offline. It may be stale; no request was made.",
    ),
  ).toBeVisible();
  expect(native.nativeHttpRequest).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Save to system credential store" }),
  ).toBeDisabled();
});

it("cancels a pending fixture without replacing its response with a success", async () => {
  render(<Network />);
  fireEvent.click(screen.getByRole("button", { name: "Run GET" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(
    await screen.findByText("Request cancelled. Existing cache was retained."),
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Run GET" })).toBeEnabled(),
  );
  expect(
    screen.getByRole("region", { name: "Validated response" }),
  ).toHaveTextContent("null");
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
  fireEvent.click(screen.getByRole("option", { name: "Real HTTPS" }));
  fireEvent.click(screen.getByRole("button", { name: "Run GET" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Run POST" }));
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Validated response" }),
    ).toHaveTextContent('"method": "POST"'),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Current failure count:/)).not.toBeInTheDocument();
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CredentialPanel, SessionPanel } from "./session-panel";

const native = vi.hoisted(() => ({
  setDemoCredential: vi.fn(),
  getDemoCredential: vi.fn(),
  deleteDemoCredential: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({ ...native, isTauri: () => true }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ language: "en", t }) };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("expires a local session on time and returns to guest on sign-out", async () => {
  vi.useFakeTimers();
  render(<SessionPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Try signing in" }));
  expect(screen.getByRole("status")).toHaveTextContent("Ada");
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(screen.getByRole("status")).toHaveTextContent("expired");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(screen.getByRole("status")).toHaveTextContent("Guest");
});

it("keeps the full display name accessible and announces session changes without reading every countdown tick", async () => {
  vi.useFakeTimers();
  render(<SessionPanel />);
  const name = "A deliberately long display name to preserve in the session";
  fireEvent.change(screen.getByLabelText("Demo display name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Try signing in" }));
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent(`Signed in as ${name}.`);
  expect(screen.getByText(name, { exact: true })).toHaveAttribute(
    "tabindex",
    "0",
  );
  const timer = screen.getByRole("timer");
  expect(timer).toHaveAttribute("aria-live", "off");
  expect(timer).toHaveTextContent("30 seconds remaining");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(timer).toHaveTextContent("29 seconds remaining");
  expect(status).toHaveTextContent(`Signed in as ${name}.`);
});

it("clears a saved input and reports credential presence without rendering the stored value", async () => {
  native.setDemoCredential.mockResolvedValue(undefined);
  native.getDemoCredential.mockResolvedValue("never-render-this-secret");
  native.deleteDemoCredential.mockResolvedValue(undefined);
  render(<CredentialPanel />);
  const input = screen.getByLabelText("Test content");
  fireEvent.change(input, { target: { value: "explicit demo input" } });
  fireEvent.click(screen.getByRole("button", { name: "Save securely" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Test content saved. The input was cleared.",
    ),
  );
  expect(input).toHaveValue("");
  expect(native.setDemoCredential).toHaveBeenCalledWith("explicit demo input");
  fireEvent.click(screen.getByRole("button", { name: "Check saved content" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Saved content was found. Its text is not displayed.",
    ),
  );
  expect(
    screen.queryByText("never-render-this-secret"),
  ).not.toBeInTheDocument();
  expect(input).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Delete saved content" }));
  const confirmation = screen.getByRole("dialog", {
    name: "Delete test content from system secure storage?",
  });
  expect(native.deleteDemoCredential).not.toHaveBeenCalled();
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Delete saved content" }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Test content deleted."),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("does not delete a credential when confirmation is cancelled and keeps a failed confirmation open for retry", async () => {
  render(<CredentialPanel />);
  const remove = screen.getByRole("button", { name: "Delete saved content" });
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(native.deleteDemoCredential).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  native.deleteDemoCredential.mockRejectedValueOnce({
    code: "CREDENTIAL_ERROR",
  });
  fireEvent.click(remove);
  const confirmation = screen.getByRole("dialog");
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Delete saved content" }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(confirmation).toBeVisible();
  expect(
    within(confirmation).getByRole("button", { name: "Delete saved content" }),
  ).toBeEnabled();
});

it("凭据写入失败通过 toast 反馈并保留输入供重试", async () => {
  native.setDemoCredential.mockRejectedValue(
    new Error("Credential store unavailable"),
  );
  render(<CredentialPanel />);
  const input = screen.getByLabelText("Test content");
  fireEvent.change(input, { target: { value: "keep secret input" } });
  fireEvent.click(screen.getByRole("button", { name: "Save securely" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Operation failed: Credential store unavailable",
    ),
  );
  expect(input).toHaveValue("keep secret input");
  expect(input).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

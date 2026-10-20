import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CredentialPanel, SessionPanel } from "./session-panel";

const native = vi.hoisted(() => ({
  setDemoCredential: vi.fn(),
  getDemoCredential: vi.fn(),
  deleteDemoCredential: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({ ...native, isTauri: () => true }));
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
  fireEvent.click(screen.getByRole("button", { name: "Start local session" }));
  expect(screen.getByRole("status")).toHaveTextContent("Ada");
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(screen.getByRole("status")).toHaveTextContent("expired");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(screen.getByRole("status")).toHaveTextContent("Guest");
});

it("clears a saved input and reports credential presence without rendering the stored value", async () => {
  native.setDemoCredential.mockResolvedValue(undefined);
  native.getDemoCredential.mockResolvedValue("never-render-this-secret");
  native.deleteDemoCredential.mockResolvedValue(undefined);
  render(<CredentialPanel />);
  const input = screen.getByLabelText("Demo credential");
  fireEvent.change(input, { target: { value: "explicit demo input" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save to system credential store" }),
  );
  expect(
    await screen.findByText("Demo credential saved. The input was cleared."),
  ).toBeVisible();
  expect(input).toHaveValue("");
  expect(native.setDemoCredential).toHaveBeenCalledWith("explicit demo input");
  fireEvent.click(
    screen.getByRole("button", { name: "Check stored credential" }),
  );
  expect(
    await screen.findByText(
      "A demo credential was read. Its content is not displayed.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("never-render-this-secret"),
  ).not.toBeInTheDocument();
  expect(input).toHaveValue("");
  fireEvent.click(
    screen.getByRole("button", { name: "Delete demo credential" }),
  );
  expect(await screen.findByText("Demo credential deleted.")).toBeVisible();
});

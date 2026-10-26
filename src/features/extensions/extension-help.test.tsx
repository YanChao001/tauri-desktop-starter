import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExtensionHelp } from "./extension-help";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps guidance out of the toolbar until a deliberate hover and remains available from keyboard focus", async () => {
  vi.useFakeTimers();
  render(
    <ExtensionHelp label="Session files">
      Export before ending to retain progress.
    </ExtensionHelp>,
  );
  const help = screen.getByRole("button", { name: "About Session files" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.pointerMove(help, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(50));
  expect(screen.getByRole("tooltip")).toHaveTextContent(
    "Export before ending to retain progress.",
  );
  fireEvent.keyDown(help, { key: "Escape" });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.focus(help);
  expect(screen.getByRole("tooltip")).toHaveTextContent(
    "Export before ending to retain progress.",
  );
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceStudio } from "./workspace-studio";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(cleanup);

it("moves the selected file between folders using only the keyboard and preserves its edits and undo", async () => {
  const user = userEvent.setup();
  render(<WorkspaceStudio />);
  const editor = screen.getByRole("textbox", { name: "Sample file contents" });
  fireEvent.change(editor, { target: { value: "Keep this draft" } });
  const move = screen.getByRole("button", { name: "Move to" });
  move.focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("menuitem", { name: "Code & data" });
  await user.keyboard("{Enter}");
  expect(editor).toHaveValue("Keep this draft");
  expect(screen.getByRole("treeitem", { name: /brief.md/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "Move file up" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Move file down" })).toBeDisabled();
  expect(move).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Undo last change" }));
  expect(editor).toHaveValue("Keep this draft");
  expect(screen.getByRole("button", { name: "Move file up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move file down" })).toBeEnabled();
});

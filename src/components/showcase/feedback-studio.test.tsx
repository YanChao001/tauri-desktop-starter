import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FeedbackStudio } from "./feedback-studio";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ t, language: "en" }) };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("keeps one accessible validation slot through invalid, duplicate and successful demo invitations", async () => {
  render(
    <TooltipProvider>
      <FeedbackStudio />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add collaborator" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveAccessibleDescription(
    "Demo invitations stay on this page; no email is sent.",
  );
  const input = within(dialog).getByLabelText("Email address");
  const submit = within(dialog).getByRole("button", {
    name: "Add",
  });
  const slot = dialog.querySelector("#playground-email-error");
  expect(slot).toBeEmptyDOMElement();
  fireEvent.click(submit);
  expect(within(dialog).getByRole("alert")).toBe(slot);
  expect(input).toHaveAccessibleDescription("Enter a valid email address.");
  fireEvent.change(input, { target: { value: "mika@example.com" } });
  expect(slot).toBeEmptyDOMElement();
  fireEvent.click(submit);
  expect(within(dialog).getByRole("alert")).toBe(slot);
  expect(input).toHaveAccessibleDescription("This email is already listed.");
  fireEvent.change(input, { target: { value: " new@example.com " } });
  fireEvent.click(submit);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("new@example.com")).toBeVisible();
  expect(toast.success).toHaveBeenCalledWith("Demo collaborator added");
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { OrderForm } from "./order-form";
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ language: "en", t: createTranslator(en) }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("complex demo form", () => {
  it("retains every input after a failed submission and permits retry", async () => {
    render(<OrderForm />);
    fireEvent.change(screen.getByLabelText("Applicant"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Design review" },
    });
    fireEvent.click(screen.getByLabelText("I confirm this is local demo data"));
    fireEvent.click(screen.getByLabelText("Simulate submission failure"));
    fireEvent.click(
      screen.getByRole("button", { name: "Submit demo request" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Input was retained"),
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Applicant")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Description")).toHaveValue("Design review");
    fireEvent.click(screen.getByLabelText("Simulate submission failure"));
    fireEvent.click(
      screen.getByRole("button", { name: "Submit demo request" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("Demo submitted"),
      ),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("locates a conditional field error and keeps dynamic line identities usable", async () => {
    render(<OrderForm />);
    fireEvent.keyDown(screen.getByLabelText("Request type"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Business" }));
    fireEvent.click(screen.getByRole("button", { name: "Add line item" }));
    expect(screen.getAllByLabelText("Description")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove line 2" }));
    expect(screen.getAllByLabelText("Description")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Submit demo request" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Check these fields/ }),
    );
    const company = await screen.findByRole("link", {
      name: /Company name: Business requests require/,
    });
    fireEvent.click(company);
    await waitFor(() => expect(company).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByLabelText("Company name")).toHaveFocus(),
    );
    const summaryTrigger = screen.getByRole("button", {
      name: /Check these fields/,
    });
    fireEvent.click(summaryTrigger);
    const reopenedCompany = await screen.findByRole("link", {
      name: /Company name: Business requests require/,
    });
    fireEvent.keyDown(reopenedCompany, { key: "Escape" });
    await waitFor(() => expect(reopenedCompany).not.toBeInTheDocument());
    await waitFor(() => expect(summaryTrigger).toHaveFocus());
    fireEvent.keyDown(screen.getByLabelText("Request type"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Personal" }));
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Company name:/ }),
    ).not.toBeInTheDocument();
  });

  it("exposes field errors beside their labels with complete keyboard-readable descriptions", async () => {
    render(<OrderForm />);
    const applicant = screen.getByLabelText("Applicant");
    const consent = screen.getByLabelText("I confirm this is local demo data");
    expect(applicant).not.toHaveAttribute("aria-describedby");
    expect(consent).not.toHaveAttribute("aria-describedby");
    expect(document.querySelector('[id$="-error"]')).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Submit demo request" }),
    );
    await waitFor(() => {
      expect(applicant).toHaveAttribute("aria-invalid", "true");
      expect(applicant).toHaveAccessibleDescription(
        "Enter at least 2 characters.",
      );
      expect(consent).toHaveAccessibleDescription("Confirm this is demo data.");
    });
    const error = screen.getByText("Enter at least 2 characters.", {
      selector: "#order-customer-error",
    });
    expect(error).toHaveAttribute("type", "button");
    fireEvent.focus(error);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Enter at least 2 characters.",
    );
    fireEvent.change(applicant, { target: { value: "Ada Lovelace" } });
    await waitFor(() => {
      expect(applicant).toHaveAttribute("aria-invalid", "false");
      expect(applicant).not.toHaveAttribute("aria-describedby");
      expect(error).not.toBeInTheDocument();
    });
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CsvImport } from "./csv-import";
import { MAX_CSV_BYTES } from "./csv";
import { saveTextExport } from "@/lib/tauri";
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/tauri", () => ({ saveTextExport: vi.fn() }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps CSV input errors separate from export failures shown as toasts", async () => {
  vi.mocked(saveTextExport).mockRejectedValueOnce({ code: "STORAGE_IO" });
  render(<CsvImport onImport={vi.fn()} />);
  fireEvent.click(screen.getByText("Import, validate and export"));
  fireEvent.click(screen.getByRole("button", { name: "Download CSV sample" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(expect.any(String)),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("requires explicit partial import consent and invalidates a preview when the source changes", () => {
  const imported = vi.fn();
  render(<CsvImport onImport={imported} />);
  fireEvent.click(screen.getByText("Import, validate and export"));
  fireEvent.click(
    screen.getByRole("button", { name: "Load sample with errors" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "2 valid rows, 1 invalid rows",
  );
  const apply = screen.getByRole("button", { name: "Import valid records" });
  expect(apply).toBeDisabled();
  expect(imported).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Import valid rows only and retain invalid rows in the report",
    }),
  );
  fireEvent.click(apply);
  expect(imported).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ email: "mei@example.test" }),
    ]),
  );
  expect(imported.mock.calls[0]?.[0]).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("CSV source (edit and check again)"), {
    target: { value: "name,email\nNew,new@example.com" },
  });
  expect(
    screen.queryByRole("button", { name: "Import valid records" }),
  ).not.toBeInTheDocument();
  expect(imported).toHaveBeenCalledOnce();
});

it("invalidates the previous import preview when another file cannot be read", async () => {
  const imported = vi.fn();
  render(<CsvImport onImport={imported} />);
  fireEvent.click(screen.getByText("Import, validate and export"));
  fireEvent.change(screen.getByLabelText("CSV source (edit and check again)"), {
    target: { value: "name,email\nNew,new@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check and preview" }));
  expect(
    screen.getByRole("button", { name: "Import valid records" }),
  ).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Choose a UTF-8 CSV file"), {
    target: {
      files: [new File(["x".repeat(MAX_CSV_BYTES + 1)], "too-large.csv")],
    },
  });
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Import valid records" }),
    ).not.toBeInTheDocument(),
  );
  expect(imported).not.toHaveBeenCalled();
});

it("rejects an oversized pasted source without silently truncating complete records", () => {
  const imported = vi.fn();
  render(<CsvImport onImport={imported} />);
  fireEvent.click(screen.getByText("Import, validate and export"));
  const source = screen.getByLabelText("CSV source (edit and check again)");
  expect(source).not.toHaveAttribute("maxlength");
  const oversized =
    "name,email\n" + "A,a@example.test\n".repeat(MAX_CSV_BYTES / 16);
  fireEvent.change(source, { target: { value: oversized } });
  expect(source).toHaveValue(oversized);
  fireEvent.click(screen.getByRole("button", { name: "Check and preview" }));
  expect(screen.getByRole("alert")).toHaveTextContent("2 MiB");
  expect(
    screen.queryByRole("button", { name: "Import valid records" }),
  ).not.toBeInTheDocument();
  expect(imported).not.toHaveBeenCalled();
});

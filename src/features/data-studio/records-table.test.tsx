import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecordsTable } from "./records-table";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ language: "en", t }) };
});
afterEach(cleanup);

it("uses stable selection through filtering and retains failed bulk records", () => {
  render(<RecordsTable />);
  fireEvent.click(screen.getByLabelText("Select record 2"));
  fireEvent.click(screen.getByLabelText("Select record 7"));
  expect(
    screen.getByRole("checkbox", { name: "Select all filtered records" }),
  ).toBePartiallyChecked();
  fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));
  expect(screen.getByRole("status")).toHaveTextContent("1 succeeded, 1 failed");
  expect(screen.getByLabelText("Select record 7")).toBeChecked();
  expect(screen.getByLabelText("Select record 2")).not.toBeChecked();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Demo 00007" },
  });
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  expect(screen.getByLabelText("Select record 7")).toBeChecked();
});

it("sorts the whole model and limits rendered rows in virtual mode", () => {
  render(<RecordsTable />);
  const sort = screen.getByRole("button", { name: /Name/ });
  fireEvent.click(sort);
  fireEvent.click(sort);
  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  expect(
    within(screen.getByRole("table")).getAllByRole("row")[1],
  ).toHaveTextContent("Demo 10000");
  fireEvent.click(screen.getByLabelText("Virtual scrolling"));
  expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "10001");
  expect(
    within(screen.getByRole("table")).getAllByRole("row").length,
  ).toBeLessThan(100);
});

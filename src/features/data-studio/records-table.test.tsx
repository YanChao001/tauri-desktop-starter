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
import { RecordsTable } from "./records-table";
import { saveTextExport } from "@/lib/tauri";
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import type { UnsavedWork } from "@/providers/unsaved-work";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof import("@/lib/tauri")>()),
  saveTextExport: vi.fn(),
}));
const lifecycle = vi.hoisted(() => ({ work: null as UnsavedWork | null }));
vi.mock("@/providers/unsaved-work", () => ({
  useUnsavedWork: (work: UnsavedWork) => {
    lifecycle.work = work;
  },
}));

const locale = vi.hoisted(() => ({ language: "en" as "en" | "zh" }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const { zhCN } = await import("@/i18n/zh-CN");
  const translators = { en: createTranslator(en), zh: createTranslator(zhCN) };
  return {
    useI18n: () => ({
      language: locale.language,
      t: translators[locale.language],
    }),
  };
});
afterEach(() => {
  cleanup();
  locale.language = "en";
  vi.clearAllMocks();
});

it("retains imported data through filtered and cancelled exports, and clears dirty state after full export", async () => {
  vi.mocked(saveTextExport).mockResolvedValue("records.csv");
  render(<RecordsTable />);
  fireEvent.click(screen.getByText("Import, validate and export"));
  fireEvent.click(
    screen.getByRole("button", { name: "Load sample with errors" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Import valid rows only; keep invalid rows in the report",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Import valid records" }));
  expect(lifecycle.work?.dirty).toBe(true);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Alex" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export filtered CSV" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Export all CSV" }),
    ).toBeEnabled(),
  );
  expect(saveTextExport).toHaveBeenLastCalledWith(
    "records.csv",
    expect.stringContaining("alex@example.test"),
  );
  expect(vi.mocked(saveTextExport).mock.calls.at(-1)?.[1]).not.toContain(
    "mei@example.test",
  );
  expect(lifecycle.work?.dirty).toBe(true);
  vi.mocked(saveTextExport).mockResolvedValueOnce(null);
  await act(async () => {
    await expect(lifecycle.work!.save()).rejects.toMatchObject({
      code: "USER_CANCELLED",
    });
  });
  expect(lifecycle.work?.dirty).toBe(true);
  await act(async () => {
    await lifecycle.work!.save();
  });
  expect(lifecycle.work?.dirty).toBe(false);
  expect(saveTextExport).toHaveBeenLastCalledWith(
    "records.csv",
    expect.stringContaining("mei@example.test"),
  );
});

it("keeps a completed export saved when lifecycle waiting is cancelled during the native save", async () => {
  const controller = new AbortController();
  vi.mocked(saveTextExport).mockImplementationOnce(async () => {
    controller.abort();
    return "records.csv";
  });
  render(<RecordsTable />);
  fireEvent.click(screen.getByText("Import, validate and export"));
  fireEvent.click(
    screen.getByRole("button", { name: "Load sample with errors" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Import valid rows only; keep invalid rows in the report",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Import valid records" }));
  expect(lifecycle.work?.dirty).toBe(true);
  await act(async () => {
    await expect(
      lifecycle.work!.save(controller.signal),
    ).resolves.toBeUndefined();
  });
  expect(saveTextExport).toHaveBeenCalledOnce();
  expect(lifecycle.work?.dirty).toBe(false);
});

it("uses stable selection through filtering and retains failed bulk records", () => {
  render(<RecordsTable />);
  fireEvent.click(screen.getByLabelText("Select record 2"));
  fireEvent.click(screen.getByLabelText("Select record 7"));
  expect(
    screen.getByRole("checkbox", { name: "Select all filtered records" }),
  ).toBePartiallyChecked();
  fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining("1 archived, 1 failed"),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByLabelText("Continuous scrolling"));
  expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "10001");
  expect(
    within(screen.getByRole("table")).getAllByRole("row").length,
  ).toBeLessThan(100);
});

it("切换语言后团队列与搜索使用当前翻译，并保留选中记录", () => {
  const { rerender } = render(<RecordsTable />);
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.click(screen.getByRole("button", { name: /Name/ }));
  expect(
    screen.getAllByRole("cell", { name: "Design" }).length,
  ).toBeGreaterThan(0);
  locale.language = "zh";
  rerender(<RecordsTable />);
  expect(screen.getByRole("columnheader", { name: /名称/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  expect(screen.queryAllByRole("cell", { name: "Design" })).toHaveLength(0);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "设计" },
  });
  expect(screen.getAllByRole("cell", { name: "设计" }).length).toBeGreaterThan(
    0,
  );
  expect(screen.getByLabelText("选择记录 1")).toBeChecked();
});

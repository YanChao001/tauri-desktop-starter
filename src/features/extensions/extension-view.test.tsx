import { useLayoutEffect, useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionView as View } from "@/lib/tauri";
import { ExtensionView } from "./extension-view";

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

it("keeps the selected panel populated in the same commit when moving forward and backward", () => {
  const visible: boolean[] = [];
  function Surface({ active }: { active: string }) {
    const root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      // 在每次提交后立即检查，捕获 Presence 延后一轮渲染造成的内容高度空档。
      const panel = root.current?.querySelector<HTMLElement>(
        '[role="tabpanel"][data-state="active"]',
      );
      visible.push(
        Boolean(panel && !panel.hidden && panel.querySelector("input")),
      );
    });
    const view: View = {
      version: 2,
      state: active,
      display: "Result",
      description: "Panel content",
      tabs: ["overview", "text"].map((id) => ({
        id,
        label: id,
        active: id === active,
      })),
      fields: [{ id: "text", label: "Text", value: "Draft" }],
      groups: [],
    };
    return (
      <div ref={root}>
        <ExtensionView
          view={view}
          fields={{ text: "Draft" }}
          blocked={false}
          invalidFields={new Set()}
          onField={vi.fn()}
          onAction={vi.fn()}
        />
      </div>
    );
  }
  const mounted = render(<Surface active="overview" />);
  mounted.rerender(<Surface active="text" />);
  mounted.rerender(<Surface active="overview" />);
  expect(visible).toEqual([true, true, true]);
});

it("renders protocol select fields with keyboard access and preserves an empty option value", async () => {
  const user = userEvent.setup();
  const onField = vi.fn();
  const view: View = {
    version: 2,
    state: "",
    display: "Choose",
    description: "Selection",
    fields: [
      {
        id: "mode",
        label: "Mode",
        value: "",
        kind: "select",
        options: [
          { value: "", label: "None" },
          { value: "upper", label: "Uppercase" },
        ],
      },
    ],
    groups: [],
  };
  render(
    <ExtensionView
      view={view}
      fields={{ mode: "" }}
      blocked={false}
      invalidFields={new Set()}
      onField={onField}
      onAction={vi.fn()}
    />,
  );
  const select = screen.getByRole("combobox", { name: "Mode" });
  expect(select).toHaveTextContent("None");
  await user.tab();
  expect(select).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(await screen.findByRole("option", { name: "None" })).toBeVisible();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onField).toHaveBeenCalledWith("mode", "upper");
});

it("shows plugin field errors accessibly and allows corrected actions", async () => {
  const user = userEvent.setup();
  const onField = vi.fn();
  const onAction = vi.fn();
  const view: View = {
    version: 2,
    state: "",
    display: "Tasks",
    description: "",
    fields: [
      { id: "due", label: "Due date", value: "", kind: "date", maxBytes: 10 },
    ],
    groups: [
      {
        columns: 1,
        actions: [
          { id: "save", label: "Save", primary: true, disabled: false },
        ],
      },
    ],
    errors: { due: "Choose a future date" },
  };
  render(
    <ExtensionView
      view={view}
      fields={{ due: "" }}
      blocked={false}
      invalidFields={new Set()}
      onField={onField}
      onAction={onAction}
    />,
  );
  const input = screen.getByLabelText("Due date");
  expect(input).toHaveAttribute("type", "date");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("Choose a future date");
  fireEvent.change(input, { target: { value: "2026-10-25" } });
  expect(onField).toHaveBeenCalledWith("due", "2026-10-25");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onAction).toHaveBeenCalledWith("save");
});

it("paginates large contributed tables and exposes progress semantics", async () => {
  const user = userEvent.setup();
  const view: View = {
    version: 2,
    state: "",
    display: "Data",
    description: "",
    fields: [],
    groups: [],
    blocks: [
      {
        kind: "table",
        columns: ["Task"],
        rows: Array.from({ length: 120 }, (_, index) => [`Task ${index + 1}`]),
      },
      { kind: "progress", label: "Completed", value: 3, max: 4 },
    ],
  };
  const mounted = render(
    <ExtensionView
      view={view}
      fields={{}}
      blocked={false}
      invalidFields={new Set()}
      onField={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("row")).toHaveLength(51);
  expect(screen.getByText("Task 1")).toBeVisible();
  expect(screen.queryByText("Task 51")).toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "Completed" }),
  ).toHaveAttribute("value", "3");
  await user.click(screen.getByRole("button", { name: "data.next" }));
  expect(screen.getByText("Task 51")).toBeVisible();
  expect(screen.queryByText("Task 1")).toBeNull();
  const shorter = {
    ...view,
    blocks: [
      { kind: "table" as const, columns: ["Task"], rows: [["Only row"]] },
    ],
  };
  mounted.rerender(
    <ExtensionView
      view={shorter}
      fields={{}}
      blocked={false}
      invalidFields={new Set()}
      onField={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByText("Only row")).toBeVisible();
});

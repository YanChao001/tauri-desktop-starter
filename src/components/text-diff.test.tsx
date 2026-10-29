import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TextDiff } from "./text-diff";
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(cleanup);

it("选择其他版本仅放入编辑器，源内容变化后不沿用旧选择", () => {
  const apply = vi.fn();
  const view = render(
    <TextDiff local={"a\nlocal\nz"} remote={"a\nother\nz"} onApply={apply} />,
  );
  const group = screen.getByRole("radiogroup");
  fireEvent.click(within(group).getByRole("radio", { name: "Other version" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Apply merge to editor" }),
  );
  expect(apply).toHaveBeenLastCalledWith("a\nother\nz");
  view.rerender(
    <TextDiff
      local={"a\nnew local\nz"}
      remote={"a\nother\nz"}
      onApply={apply}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Apply merge to editor" }),
  );
  expect(apply).toHaveBeenLastCalledWith("a\nnew local\nz");
});

it("长文本预览有界，但采用其他版本不会截断真实内容", () => {
  const remote = "x".repeat(220000);
  const apply = vi.fn();
  render(<TextDiff local="local" remote={remote} onApply={apply} />);
  expect(document.body.textContent?.length).toBeLessThan(10000);
  fireEvent.click(screen.getByRole("radio", { name: "Other version" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Apply merge to editor" }),
  );
  expect(apply).toHaveBeenCalledWith(remote);
});

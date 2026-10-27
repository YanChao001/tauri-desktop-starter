import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { workbenchEditor } from "@/components/workbench/editor-store";
import Workbench from "./workbench";

const preview = vi.hoisted(() => {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, requested: vi.fn() };
});
vi.mock("@/components/workbench/document-preview", async (importOriginal) => {
  preview.requested();
  await preview.ready;
  return importOriginal();
});
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/hooks/use-latest-translator", () => ({
  useLatestTranslator: () => (key: string) => key,
}));
vi.mock("@/providers/commands", () => ({ useRegisterCommands: () => {} }));
vi.mock("@/providers/unsaved-work", () => ({ useUnsavedWork: () => {} }));
vi.mock("@/components/native-page", () => ({
  NativePage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  recentWorkbenchFiles: () => Promise.resolve([]),
  onWorkbenchDrop: () => Promise.resolve(() => {}),
}));

afterEach(() => {
  preview.release();
  cleanup();
  for (const entry of workbenchEditor.getSnapshot().entries)
    workbenchEditor.close(entry.document.id);
});

it("空工作台不加载预览，预览模块等待时仍可新建和编辑草稿", async () => {
  const { container } = render(
    <MemoryRouter>
      <Workbench />
    </MemoryRouter>,
  );
  expect(screen.getByText("workbench.empty")).toBeVisible();
  expect(preview.requested).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "workbench.new" }));
  await waitFor(() => expect(preview.requested).toHaveBeenCalledOnce());
  expect(screen.getByRole("status")).toHaveTextContent("common.loading");
  const editor = screen.getByLabelText("workbench.editor");
  expect(editor).toBeEnabled();
  fireEvent.change(editor, { target: { value: "draft while preview loads" } });
  expect(editor).toHaveValue("draft while preview loads");
  expect(workbenchEditor.hasUnsavedChanges()).toBe(true);

  await act(async () => preview.release());
  await waitFor(() =>
    expect(container.querySelector("pre code")).toHaveTextContent(
      "draft while preview loads",
    ),
  );
  expect(editor).toHaveValue("draft while preview loads");
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { UnsavedWork } from "@/providers/unsaved-work";
import * as native from "@/lib/tauri";
import { workbenchEditor } from "@/components/workbench/editor-store";
import Workbench from "./workbench";

const lifecycle = vi.hoisted(() => ({ work: null as UnsavedWork | null }));
vi.mock("@/providers/unsaved-work", () => ({
  useUnsavedWork: (work: UnsavedWork) => {
    lifecycle.work = work;
  },
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/hooks/use-latest-translator", () => ({
  useLatestTranslator: () => (key: string) => key,
}));
vi.mock("@/providers/commands", () => ({ useRegisterCommands: () => {} }));
vi.mock("@/components/native-page", () => ({
  NativePage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  createNote: vi.fn(),
  pickWorkbenchFiles: vi.fn(),
  recentWorkbenchFiles: vi.fn(),
  onWorkbenchDrop: vi.fn(),
  loadWorkbenchDocument: vi.fn(),
  saveWorkbenchDocument: vi.fn(),
  saveWorkbenchAs: vi.fn(),
  revealWorkbenchFile: vi.fn(),
}));

const selected = {
  id: "file-1",
  name: "note.txt",
  path: "C:/selected/note.txt",
  kind: "text" as const,
  content: "original",
  previewUrl: null,
  revision: "v1",
  bytes: 8,
};
beforeEach(() => {
  for (const entry of workbenchEditor.getSnapshot().entries)
    workbenchEditor.close(entry.document.id);
  workbenchEditor.clearActivationErrors();
  lifecycle.work = null;
  vi.clearAllMocks();
  vi.mocked(native.recentWorkbenchFiles).mockResolvedValue([]);
  vi.mocked(native.onWorkbenchDrop).mockResolvedValue(vi.fn());
  vi.mocked(native.pickWorkbenchFiles).mockResolvedValue([selected]);
});
afterEach(cleanup);

describe("file workbench", () => {
  it("shows file-association failures collected before mounting and clears them explicitly", async () => {
    await workbenchEditor.openActivation(
      {
        id: 1000,
        source: "startup",
        route: "/workbench",
        files: ["bad.json"],
        resourceIds: [],
        errors: ["bad.json: invalid document"],
      },
      native.loadWorkbenchDocument,
    );
    render(<Workbench />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "bad.json: invalid document",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workbench.clearOpenErrors" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("imports the current draft into SQLite without discarding its file edits", async () => {
    vi.mocked(native.createNote).mockResolvedValue({
      id: 7,
      title: "note.txt",
      body: "note copy",
      version: 1,
      updatedAt: "now",
    });
    render(<Workbench />);
    fireEvent.click(screen.getByRole("button", { name: "workbench.open" }));
    const editor = await screen.findByRole("textbox", {
      name: "workbench.editor",
    });
    fireEvent.change(editor, { target: { value: "note copy" } });
    fireEvent.click(
      screen.getByRole("button", { name: "workbench.importNote" }),
    );
    await waitFor(() =>
      expect(native.createNote).toHaveBeenCalledWith({
        title: "note.txt",
        body: "note copy",
      }),
    );
    expect(
      await screen.findByRole("link", { name: "workbench.openNotes" }),
    ).toHaveAttribute("href", "#/database");
    expect(workbenchEditor.hasUnsavedChanges()).toBe(true);
    expect(editor).toHaveValue("note copy");
  });
  it("keeps edits after a conflict and preserves them when save-as is cancelled", async () => {
    vi.mocked(native.saveWorkbenchDocument).mockRejectedValue({
      code: "CONFLICT",
    });
    vi.mocked(native.saveWorkbenchAs).mockResolvedValue(null);
    render(<Workbench />);
    fireEvent.click(screen.getByRole("button", { name: "workbench.open" }));
    const editor = await screen.findByLabelText("workbench.editor");
    fireEvent.change(editor, { target: { value: "mine" } });
    fireEvent.click(screen.getByRole("button", { name: "workbench.save" }));
    await screen.findByText("workbench.conflict");
    expect(editor).toHaveValue("mine");
    expect(native.saveWorkbenchDocument).toHaveBeenCalledWith(
      "file-1",
      "mine",
      "v1",
    );
    fireEvent.click(screen.getByRole("button", { name: "workbench.saveAs" }));
    await waitFor(() =>
      expect(native.saveWorkbenchAs).toHaveBeenCalledWith("note.txt", "mine"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "workbench.save" }),
      ).toBeEnabled(),
    );
    expect(editor).toHaveValue("mine");
    expect(workbenchEditor.hasUnsavedChanges()).toBe(true);
  });

  it("retains a save callback after navigation and blocks lifecycle completion when a new-file dialog is cancelled", async () => {
    workbenchEditor.open([
      { ...selected, id: "draft-1", path: "", content: "" },
    ]);
    workbenchEditor.edit("draft-1", "do not lose me");
    vi.mocked(native.saveWorkbenchAs).mockResolvedValue(null);
    const view = render(<Workbench />);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    const work = lifecycle.work!;
    view.unmount();
    await expect(work.save()).rejects.toThrow("workbench.saveCancelled");
    expect(workbenchEditor.hasUnsavedChanges()).toBe(true);
    vi.mocked(native.saveWorkbenchAs).mockResolvedValue({
      ...selected,
      id: "saved",
      content: "do not lose me",
      revision: "v2",
    });
    await work.save();
    expect(workbenchEditor.hasUnsavedChanges()).toBe(false);
    expect(workbenchEditor.getSnapshot().entries[0]?.draft).toBe(
      "do not lose me",
    );
  });

  it("stops a cancelled lifecycle save before the next document while retaining the completed save", async () => {
    workbenchEditor.open([
      selected,
      { ...selected, id: "file-2", name: "second.txt" },
    ]);
    workbenchEditor.edit("file-1", "first edit");
    workbenchEditor.edit("file-2", "second edit");
    const controller = new AbortController();
    vi.mocked(native.saveWorkbenchDocument).mockImplementation(async () => {
      controller.abort();
      return { ...selected, content: "first edit", revision: "v2" };
    });
    const view = render(<Workbench />);
    await waitFor(() => expect(lifecycle.work?.dirty).toBe(true));
    const work = lifecycle.work!;
    view.unmount();
    await expect(work.save(controller.signal)).rejects.toThrow();
    expect(native.saveWorkbenchDocument).toHaveBeenCalledExactlyOnceWith(
      "file-1",
      "first edit",
      "v1",
    );
    expect(
      workbenchEditor
        .getSnapshot()
        .entries.find((entry) => entry.document.id === "file-1")?.document
        .content,
    ).toBe("first edit");
    expect(
      workbenchEditor
        .getSnapshot()
        .entries.find((entry) => entry.document.id === "file-2")?.draft,
    ).toBe("second edit");
    expect(workbenchEditor.hasUnsavedChanges()).toBe(true);
  });
});

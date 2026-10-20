import { describe, expect, it } from "vitest";
import type { WorkbenchDocument } from "@/lib/tauri";
import { createWorkbenchEditor } from "./editor-store";

const document = (revision = "first"): WorkbenchDocument => ({
  id: "selected",
  name: "note.md",
  path: "C:/chosen/note.md",
  kind: "markdown",
  content: revision,
  previewUrl: null,
  revision,
  bytes: 5,
});

describe("workbench document drafts", () => {
  it("preserves local edits when a drop or recent-file open discovers an external revision", () => {
    const editor = createWorkbenchEditor();
    editor.open([document()]);
    editor.edit("selected", "my unsaved work");
    editor.open([document("outside")]);
    expect(editor.getSnapshot().entries[0]).toMatchObject({
      draft: "my unsaved work",
      document: { revision: "first" },
      remoteChanged: true,
    });
    expect(editor.hasUnsavedChanges()).toBe(true);
    editor.accept(document("outside"));
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(editor.getSnapshot().entries[0]).toMatchObject({
      draft: "outside",
      remoteChanged: false,
    });
  });

  it("saving a copy retains the original draft and closing another tab keeps the selected file", () => {
    const editor = createWorkbenchEditor();
    editor.open([document()]);
    editor.edit("selected", "mine");
    const copy = { ...document("mine"), id: "copy", path: "C:/chosen/copy.md" };
    editor.accept(copy);
    expect(editor.getSnapshot().entries).toHaveLength(2);
    expect(
      editor
        .getSnapshot()
        .entries.find((entry) => entry.document.id === "selected")?.draft,
    ).toBe("mine");
    editor.close("selected");
    expect(editor.getSnapshot().selectedId).toBe("copy");
    expect(editor.hasUnsavedChanges()).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Activation, WorkbenchDocument } from "@/lib/tauri";
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
const activation = (
  id: number,
  resourceIds: string[],
  errors: string[] = [],
): Activation => ({
  id,
  resourceIds,
  errors,
  route: "/workbench",
  source: "startup",
  files: ["note.md"],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it("consumes each activation once while keeping same-named resources distinct", async () => {
    const editor = createWorkbenchEditor();
    const load = vi.fn(async (id: string) => ({ ...document(), id }));
    const event = activation(1, ["first", "second", "first"]);
    const pending = editor.openActivation(event, load);
    expect(editor.openActivation(event, load)).toBe(pending);
    await pending;
    expect(load).toHaveBeenCalledTimes(2);
    expect(
      editor.getSnapshot().entries.map((entry) => entry.document.id),
    ).toEqual(["first", "second"]);
    editor.close("first");
    await editor.openActivation(event, load);
    expect(
      editor.getSnapshot().entries.map((entry) => entry.document.id),
    ).toEqual(["second"]);
  });

  it("does not let older activation loads replace a newer resource or selection", async () => {
    const editor = createWorkbenchEditor();
    const older = deferred<WorkbenchDocument>();
    const newer = deferred<WorkbenchDocument>();
    const load = vi.fn(async (id: string) => ({ ...document(), id }));
    load
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const first = editor.openActivation(activation(1, ["selected"]), load);
    await Promise.resolve();
    const second = editor.openActivation(activation(2, ["selected"]), load);
    newer.resolve(document("newer"));
    await second;
    editor.open([{ ...document(), id: "manual" }]);
    older.resolve(document("older"));
    await first;
    expect(editor.getSnapshot().selectedId).toBe("manual");
    expect(
      editor
        .getSnapshot()
        .entries.find((entry) => entry.document.id === "selected")?.document
        .revision,
    ).toBe("newer");
  });

  it("opens late distinct resources without stealing a newer activation's selection", async () => {
    const editor = createWorkbenchEditor();
    const older = deferred<WorkbenchDocument>();
    const load = vi.fn(async (id: string) => ({ ...document(), id }));
    load.mockImplementationOnce(() => older.promise);
    const first = editor.openActivation(activation(1, ["older"]), load);
    const second = editor.openActivation(activation(2, ["newer"]), load);
    await second;
    older.resolve({ ...document(), id: "older" });
    await first;
    expect(editor.getSnapshot().selectedId).toBe("newer");
    expect(editor.getSnapshot().entries).toHaveLength(2);
  });

  it("ignores an older same-resource activation delivered only after a newer activation completed", async () => {
    const editor = createWorkbenchEditor();
    await editor.openActivation(activation(2, ["selected"]), async () =>
      document("newer"),
    );
    await editor.openActivation(activation(1, ["selected"]), async () =>
      document("older"),
    );
    expect(editor.getSnapshot().entries[0]?.document.revision).toBe("newer");
  });

  it("preserves edits and user selection while an accepted association is loading", async () => {
    const editor = createWorkbenchEditor();
    editor.open([document(), { ...document(), id: "other" }]);
    const reading = deferred<WorkbenchDocument>();
    const pending = editor.openActivation(
      activation(1, ["selected"]),
      () => reading.promise,
    );
    editor.edit("selected", "my unsaved draft");
    editor.select("other");
    reading.resolve(document("remote"));
    await pending;
    expect(editor.getSnapshot().selectedId).toBe("other");
    expect(editor.getSnapshot().entries[0]).toMatchObject({
      draft: "my unsaved draft",
      remoteChanged: true,
      document: { revision: "first" },
    });
  });

  it("retains association and reload failures until they are explicitly cleared", async () => {
    const editor = createWorkbenchEditor();
    const failed = {
      code: "NOT_FOUND",
      message: "File is no longer available",
    };
    const load = vi
      .fn<(id: string) => Promise<WorkbenchDocument>>()
      .mockRejectedValue(failed);
    await editor.openActivation(
      activation(1, ["missing"], ["Invalid document"]),
      load,
    );
    await editor.openActivation(activation(2, [], []), load);
    expect(editor.getSnapshot().activationErrors).toEqual([
      "Invalid document",
      failed,
    ]);
    editor.clearActivationErrors();
    expect(editor.getSnapshot().activationErrors).toEqual([]);
  });

  it.each(["save", "close"] as const)(
    "does not undo a user's %s when an older association read finishes",
    async (action) => {
      const editor = createWorkbenchEditor();
      editor.open([document()]);
      const reading = deferred<WorkbenchDocument>();
      const pending = editor.openActivation(
        activation(1, ["selected"]),
        () => reading.promise,
      );
      await Promise.resolve();
      if (action === "save") editor.accept(document("saved"));
      else editor.close("selected");
      reading.resolve(document("stale read"));
      await pending;
      expect(editor.getSnapshot().entries).toHaveLength(
        action === "save" ? 1 : 0,
      );
      if (action === "save")
        expect(editor.getSnapshot().entries[0]?.document.revision).toBe(
          "saved",
        );
    },
  );

  it("bounds concurrent activation reads and leaves rejected work visible for retry", async () => {
    const editor = createWorkbenchEditor();
    const reading = deferred<void>();
    const load = vi.fn(async (id: string) => {
      await reading.promise;
      return { ...document(), id };
    });
    const pending = Array.from({ length: 20 }, (_, id) =>
      editor.openActivation(activation(id + 1, [`file-${id}`]), load),
    );
    await Promise.resolve();
    await editor.openActivation(activation(21, ["over-capacity"]), load);
    expect(load).toHaveBeenCalledTimes(20);
    expect(editor.getSnapshot().activationErrors).toEqual([
      { code: "WORKBENCH_BUSY" },
    ]);
    reading.resolve();
    await Promise.all(pending);
    await editor.openActivation(activation(22, ["retried"]), load);
    expect(
      editor
        .getSnapshot()
        .entries.some((entry) => entry.document.id === "retried"),
    ).toBe(true);
  });
});

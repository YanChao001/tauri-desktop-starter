import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { Note } from "@/lib/tauri";
import type { UnsavedWork } from "@/providers/unsaved-work";
import Database from "./database";
import { toast } from "sonner";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  queryNotes: vi.fn(),
  getNote: vi.fn(),
  changeNotes: vi.fn(),
  loadNoteDraft: vi.fn(),
  saveNoteDraft: vi.fn(),
  createDataBackup: vi.fn(),
  listDataBackups: vi.fn(),
  previewDataBackup: vi.fn(),
  restoreDataBackup: vi.fn(),
  pickDataBackup: vi.fn(),
  saveDataBackup: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  onNotesChanged: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const { enData } = await import("@/i18n/en-data");
  return {
    useI18n: () => ({
      language: "en",
      t: createTranslator({ ...en, ...enData }),
    }),
  };
});
const lifecycle = vi.hoisted(() => ({
  current: null as UnsavedWork | null,
}));
vi.mock("@/providers/unsaved-work", () => ({
  useUnsavedWork: (work: UnsavedWork) => {
    lifecycle.current = work;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const first: Note = {
  id: 1,
  title: "First note",
  body: "Original text",
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let notes: Note[];
let events: Array<() => void>;
async function open(path = "/") {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Database />
    </MemoryRouter>,
  );
  await waitFor(() => expect(native.queryNotes).toHaveBeenCalled());
  return view;
}
function title() {
  return screen.getByRole("textbox", { name: "Title" });
}
function body() {
  return screen.getByRole("textbox", { name: "Content" });
}
function form() {
  return title().closest("form")!;
}

describe("native note editor", () => {
  beforeEach(() => {
    notes = [first];
    events = [];
    vi.clearAllMocks();
    vi.mocked(native.queryNotes).mockImplementation(async (query) => ({
      items: notes.slice(query.offset, query.offset + query.limit),
      total: notes.length,
      offset: query.offset,
      limit: query.limit,
    }));
    vi.mocked(native.loadNoteDraft).mockResolvedValue(null);
    vi.mocked(native.saveNoteDraft).mockResolvedValue(undefined);
    vi.mocked(native.getNote).mockImplementation(async (id) =>
      notes.find((note) => note.id === id)!,
    );
    vi.mocked(native.changeNotes).mockResolvedValue(undefined);
    vi.mocked(native.listDataBackups).mockResolvedValue([]);
    vi.mocked(native.onNotesChanged).mockImplementation(async (handler) => {
      events.push(handler);
      return vi.fn<() => void>();
    });
  });
  afterEach(async () => {
    const create = screen.queryByRole("button", { name: "New note" });
    if (create && !create.hasAttribute("disabled")) {
      fireEvent.click(create);
      const discard = screen.queryByRole("button", { name: "Discard changes" });
      if (discard) {
        await act(async () => fireEvent.click(discard));
      }
    }
    cleanup();
  });

  it("keeps a manually selected note ahead of a delayed search result", async () => {
    const requested = deferred<Note>();
    vi.mocked(native.getNote).mockReturnValueOnce(requested.promise);
    await open("/database?note=2");
    await waitFor(() => expect(native.getNote).toHaveBeenCalledWith(2));
    fireEvent.click(await screen.findByText("First note"));
    await act(async () =>
      requested.resolve({ ...first, id: 2, title: "Search result" }),
    );
    expect(title()).toHaveValue(first.title);
    expect(body()).toHaveValue(first.body);
  });

  it("requires confirmation before opening a search result over edits made during the read", async () => {
    const requested = deferred<Note>();
    vi.mocked(native.getNote).mockReturnValueOnce(requested.promise);
    await open("/database?note=2");
    await waitFor(() => expect(native.getNote).toHaveBeenCalledWith(2));
    const draftTitle = title();
    fireEvent.change(draftTitle, { target: { value: "Keep this draft" } });
    await act(async () =>
      requested.resolve({ ...first, id: 2, title: "Search result" }),
    );
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(draftTitle).toHaveValue("Keep this draft");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(title()).toHaveValue("Keep this draft");
  });

  it("rejects search identities outside the native signed 32-bit range", async () => {
    await open("/database?note=2147483648");
    await waitFor(() => expect(title()).toBeEnabled());
    expect(native.getNote).not.toHaveBeenCalled();
  });

  it("creates and updates notes using the returned version while deduplicating submissions", async () => {
    await open();
    const created = deferred<Note>();
    vi.mocked(native.createNote).mockReturnValueOnce(created.promise);
    fireEvent.change(title(), { target: { value: "Created" } });
    fireEvent.change(body(), { target: { value: "Draft body" } });
    act(() => {
      fireEvent.submit(form());
      fireEvent.submit(form());
    });
    expect(native.createNote).toHaveBeenCalledExactlyOnceWith({
      title: "Created",
      body: "Draft body",
    });
    const saved = { ...first, id: 2, title: "Created", body: "Draft body" };
    notes = [...notes, saved];
    await act(async () => created.resolve(saved));
    expect(title()).toHaveValue("Created");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    vi.mocked(native.updateNote).mockResolvedValueOnce({
      ...saved,
      body: "Updated body",
      version: 2,
    });
    fireEvent.change(body(), { target: { value: "Updated body" } });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(native.updateNote).toHaveBeenCalledExactlyOnceWith({
        id: 2,
        title: "Created",
        body: "Updated body",
        expectedVersion: 1,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
  });

  it("preserves dirty edits and their CAS version through remote changes and conflicts", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.change(body(), { target: { value: "My unsaved content" } });
    notes = [{ ...first, body: "Another window", version: 2 }];
    await act(async () => events.forEach((handler) => handler()));
    expect(body()).toHaveValue("My unsaved content");
    vi.mocked(native.updateNote).mockRejectedValueOnce({
      code: "CONFLICT",
      message: "conflict",
    });
    fireEvent.submit(form());
    await screen.findByRole("alert");
    expect(native.updateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        body: "My unsaved content",
      }),
    );
    expect(body()).toHaveValue("My unsaved content");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("refreshes clean selections from note events while filtered results preserve the editor", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    notes = [{ ...first, body: "Remote content", version: 2 }];
    await act(async () => events.forEach((handler) => handler()));
    await waitFor(() => expect(body()).toHaveValue("Remote content"));
    notes = [];
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "not matching" },
    });
    await waitFor(() =>
      expect(native.queryNotes).toHaveBeenCalledWith(
        expect.objectContaining({ search: "not matching" }),
      ),
    );
    expect(body()).toHaveValue("Remote content");
  });

  it("requires confirmation for deletion and sends one delete despite repeated confirmation", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(native.changeNotes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const removal = deferred<void>();
    vi.mocked(native.changeNotes).mockReturnValueOnce(removal.promise);
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete",
    });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(native.changeNotes).toHaveBeenCalledExactlyOnceWith(
      [{ id: 1, expectedVersion: 1 }],
      "trash",
    );
    notes = [];
    await act(async () => removal.resolve());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(title()).toHaveValue("");
  });

  it("retains an in-flight creation across route remounts without creating a duplicate", async () => {
    const creation = deferred<Note>();
    vi.mocked(native.createNote).mockReturnValueOnce(creation.promise);
    const firstView = await open();
    fireEvent.change(title(), { target: { value: "Route draft" } });
    fireEvent.submit(form());
    firstView.unmount();
    await open();
    expect(title()).toHaveValue("Route draft");
    expect(title()).toBeDisabled();
    fireEvent.submit(form());
    expect(native.createNote).toHaveBeenCalledOnce();
    const saved = { ...first, id: 3, title: "Route draft", body: "" };
    notes = [...notes, saved];
    await act(async () => creation.resolve(saved));
    await waitFor(() => expect(title()).not.toBeDisabled());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(native.createNote).toHaveBeenCalledOnce();
  });

  it("rejects overlong UTF-8 search and content locally while retaining input and results", async () => {
    await open();
    await screen.findByText("First note");
    const search = screen.getByRole("searchbox");
    const oversized = "界".repeat(67);
    fireEvent.change(search, { target: { value: oversized } });
    expect(search).toHaveValue(oversized);
    expect(search).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("First note")).toBeVisible();
    fireEvent.change(search, { target: { value: "valid" } });
    await waitFor(() =>
      expect(native.queryNotes).toHaveBeenCalledWith(
        expect.objectContaining({ search: "valid" }),
      ),
    );
    expect(native.queryNotes).not.toHaveBeenCalledWith(
      expect.objectContaining({ search: oversized }),
    );
    expect(search).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(title(), { target: { value: "Unicode note" } });
    const content = "界".repeat(21846);
    fireEvent.change(body(), { target: { value: content } });
    expect(body()).toHaveValue(content);
    expect(body()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.submit(form());
    expect(native.createNote).not.toHaveBeenCalled();
    fireEvent.change(body(), { target: { value: content.slice(0, -1) } });
    expect(body()).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("ignores obsolete note subscriptions after search changes and cleanup", async () => {
    const view = await open();
    const obsolete = events[0]!;
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "new" },
    });
    await waitFor(() =>
      expect(native.queryNotes).toHaveBeenCalledWith(
        expect.objectContaining({ search: "new" }),
      ),
    );
    const count = vi.mocked(native.queryNotes).mock.calls.length;
    await act(async () => obsolete());
    expect(native.queryNotes).toHaveBeenCalledTimes(count);
    view.unmount();
    const after = vi.mocked(native.queryNotes).mock.calls.length;
    await act(async () => events.forEach((handler) => handler()));
    expect(native.queryNotes).toHaveBeenCalledTimes(after);
  });

  it("pages beyond two hundred notes and sends explicit sort and trash filters", async () => {
    notes = Array.from({ length: 251 }, (_, index) => ({
      ...first,
      id: index + 1,
      title: `Note ${index + 1}`,
    }));
    await open();
    expect(await screen.findByText("Note 50")).toBeVisible();
    expect(screen.queryByText("Note 51")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(native.queryNotes).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 50, limit: 50 }),
      ),
    );
    expect(await screen.findByText("Note 51")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Sort" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("option", { name: "Title" }));
    await waitFor(() =>
      expect(native.queryNotes).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0, sort: "title-asc" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Recycle bin" }));
    await waitFor(() =>
      expect(native.queryNotes).toHaveBeenCalledWith(
        expect.objectContaining({ trash: true }),
      ),
    );
  });

  it("keeps selected rows after the initial search debounce period", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        render(
          <MemoryRouter>
            <Database />
          </MemoryRouter>,
        );
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select First note" }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(
        screen.getByRole("checkbox", { name: "Select First note" }),
      ).toBeChecked();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed batch selected and sends the exact versions for a single transaction", async () => {
    notes = [first, { ...first, id: 2, title: "Second note", version: 4 }];
    vi.mocked(native.changeNotes).mockRejectedValueOnce({ code: "CONFLICT" });
    await open();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select First note" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Second note" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move to recycle bin" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm operation",
      }),
    );
    await waitFor(() =>
      expect(native.changeNotes).toHaveBeenCalledExactlyOnceWith(
        [
          { id: 1, expectedVersion: 1 },
          { id: 2, expectedVersion: 4 },
        ],
        "trash",
      ),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
        id: "note-editor-error",
      }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("alert"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select First note" }),
    ).toBeChecked();
  });

  it("shows remote content after conflict and keeps local text with the reviewed remote version", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.change(body(), { target: { value: "My local work" } });
    vi.mocked(native.getNote).mockResolvedValueOnce({
      ...first,
      body: "Remote version",
      version: 2,
    });
    vi.mocked(native.updateNote).mockRejectedValueOnce({ code: "CONFLICT" });
    fireEvent.submit(form());
    fireEvent.click(await screen.findByText("View remote content"));
    expect(
      screen
        .getAllByText("Remote version")
        .some((node) => node.tagName === "PRE"),
    ).toBe(true);
    expect(body()).toHaveValue("My local work");
    fireEvent.click(
      screen.getByRole("button", { name: "Keep local and continue editing" }),
    );
    vi.mocked(native.updateNote).mockResolvedValueOnce({
      ...first,
      body: "My local work",
      version: 3,
    });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(native.updateNote).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedVersion: 2, body: "My local work" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
  });

  it("offers a separate copy instead of overwriting the remote note after conflict", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.change(body(), { target: { value: "Keep separately" } });
    vi.mocked(native.updateNote).mockRejectedValueOnce({ code: "CONFLICT" });
    fireEvent.submit(form());
    const copy = await screen.findByRole("button", { name: "Save as a copy" });
    vi.mocked(native.createNote).mockResolvedValueOnce({
      ...first,
      id: 9,
      body: "Keep separately",
    });
    fireEvent.click(copy);
    await waitFor(() =>
      expect(native.createNote).toHaveBeenCalledWith({
        title: "First note",
        body: "Keep separately",
      }),
    );
    expect(native.updateNote).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
  });

  it("merges chosen title and body without persisting, then still rejects a newer concurrent version", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.change(body(), { target: { value: "Local body" } });
    vi.mocked(native.getNote).mockResolvedValueOnce({
      ...first,
      title: "Reviewed title",
      body: "Reviewed body",
      version: 2,
    });
    vi.mocked(native.updateNote).mockRejectedValueOnce({ code: "CONFLICT" });
    fireEvent.submit(form());
    const conflict = await screen.findByRole("region", {
      name: "Note version conflict",
    });
    fireEvent.click(
      await within(conflict).findByRole("radio", {
        name: "Use other version title: Reviewed title",
      }),
    );
    fireEvent.click(
      within(conflict).getByRole("radio", { name: "Other version" }),
    );
    fireEvent.click(
      within(conflict).getByRole("button", {
        name: "Apply merged result to editor",
      }),
    );
    expect(native.updateNote).toHaveBeenCalledOnce();
    expect(title()).toHaveValue("Reviewed title");
    expect(body()).toHaveValue("Reviewed body");
    // 选择完全采用远端正文后，再做编辑以产生一次真实保存。
    fireEvent.change(body(), {
      target: { value: "Reviewed body with my addition" },
    });
    vi.mocked(native.getNote).mockResolvedValueOnce({
      ...first,
      body: "Changed again",
      version: 3,
    });
    vi.mocked(native.updateNote).mockRejectedValueOnce({ code: "CONFLICT" });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(native.updateNote).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedVersion: 2,
          title: "Reviewed title",
          body: "Reviewed body with my addition",
        }),
      ),
    );
    await screen.findByRole("region", { name: "Note version conflict" });
    expect(body()).toHaveValue("Reviewed body with my addition");
  });

  it("recovers the persisted window draft and waits for its deletion when discarded", async () => {
    vi.mocked(native.loadNoteDraft).mockResolvedValueOnce({
      noteId: 1,
      title: "Recovered",
      body: "Unsaved body",
      expectedVersion: 1,
      originalTitle: first.title,
      originalBody: first.body,
    });
    await open();
    await waitFor(() => expect(title()).toHaveValue("Recovered"));
    expect(body()).toHaveValue("Unsaved body");
    expect(lifecycle.current?.dirty).toBe(true);
    const removal = deferred<void>();
    vi.mocked(native.saveNoteDraft).mockReturnValueOnce(removal.promise);
    let finished = false;
    const discarding = lifecycle.current!.discard();
    void Promise.resolve(discarding).then(() => {
      finished = true;
    });
    await waitFor(() =>
      expect(native.saveNoteDraft).toHaveBeenCalledWith(null),
    );
    expect(finished).toBe(false);
    await act(async () => {
      removal.resolve();
      await discarding;
    });
    expect(finished).toBe(true);
    expect(body()).toHaveValue(first.body);
  });

  it("propagates failed lifecycle saves while retaining the draft", async () => {
    await open();
    fireEvent.change(title(), { target: { value: "Must survive" } });
    vi.mocked(native.createNote).mockRejectedValueOnce({ code: "STORAGE_IO" });
    await act(async () => {
      await expect(lifecycle.current!.save()).rejects.toEqual({
        code: "STORAGE_IO",
      });
    });
    expect(title()).toHaveValue("Must survive");
    expect(lifecycle.current?.dirty).toBe(true);
  });

  it("keeps a failed in-flight save's draft when the waiting discard is cancelled", async () => {
    await open();
    fireEvent.change(title(), {
      target: { value: "Must survive cancellation" },
    });
    const saving = deferred<void>();
    vi.mocked(native.createNote).mockImplementationOnce(async () => {
      await saving.promise;
      throw { code: "STORAGE_IO" };
    });
    fireEvent.submit(form());
    const controller = new AbortController();
    const discarding = Promise.resolve(
      lifecycle.current!.discard(controller.signal),
    );
    controller.abort();
    await act(async () => {
      saving.resolve();
      await expect(discarding).rejects.toThrow();
    });
    expect(title()).toHaveValue("Must survive cancellation");
    expect(lifecycle.current?.dirty).toBe(true);
  });

  it("does not start persistence or refresh after a lifecycle save is cancelled", async () => {
    await open();
    fireEvent.change(title(), { target: { value: "Committed before cancel" } });
    const work = lifecycle.current!;
    vi.mocked(native.saveNoteDraft).mockClear();
    vi.mocked(native.queryNotes).mockClear();
    const controller = new AbortController();
    vi.mocked(native.createNote).mockImplementationOnce(async () => {
      controller.abort();
      return { ...first, title: "Committed before cancel" };
    });
    await act(async () => {
      await expect(work.save(controller.signal)).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(native.saveNoteDraft).not.toHaveBeenCalled();
    expect(native.queryNotes).not.toHaveBeenCalled();
    expect(title()).toHaveValue("Committed before cancel");
    expect(lifecycle.current?.dirty).toBe(false);
  });

  it("does not submit or discard drafts for an already cancelled lifecycle request", async () => {
    await open();
    fireEvent.change(title(), { target: { value: "Still dirty" } });
    const controller = new AbortController();
    controller.abort();
    await expect(lifecycle.current!.save(controller.signal)).rejects.toThrow();
    await expect(
      lifecycle.current!.discard(controller.signal),
    ).rejects.toThrow();
    expect(native.createNote).not.toHaveBeenCalled();
    expect(title()).toHaveValue("Still dirty");
  });

  it("clears a persisted draft when edits are manually reverted to the original", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.change(body(), { target: { value: "Temporary edit" } });
    await waitFor(() =>
      expect(native.saveNoteDraft).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Temporary edit" }),
      ),
    );
    fireEvent.change(body(), { target: { value: first.body } });
    await waitFor(() =>
      expect(native.saveNoteDraft).toHaveBeenLastCalledWith(null),
    );
    expect(lifecycle.current?.dirty).toBe(false);
  });

  it("previews a complete backup and restores only after explicit confirmation", async () => {
    const info = {
      id: "notes-backup-example.json",
      createdAt: first.updatedAt,
      notes: 251,
      trashed: 2,
      drafts: 1,
      bytes: 2048,
    };
    vi.mocked(native.listDataBackups).mockResolvedValue([info]);
    vi.mocked(native.previewDataBackup).mockResolvedValue({
      info,
      schemaVersion: 2,
      sampleTitles: ["Restorable title"],
    });
    vi.mocked(native.restoreDataBackup).mockResolvedValue({
      restored: 253,
      safetyBackup: { ...info, id: "notes-backup-safety.json" },
    });
    await open();
    fireEvent.click(screen.getByText("Backup and restore"));
    const preview = await screen.findByRole("button", {
      name: "Preview backup",
    });
    fireEvent.click(preview);
    expect(await screen.findByText("Restorable title")).toBeVisible();
    expect(native.restoreDataBackup).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Restore this backup",
      }),
    );
    await waitFor(() =>
      expect(native.restoreDataBackup).toHaveBeenCalledExactlyOnceWith(info.id),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("Restored 253 records"),
      ),
    );
    expect(screen.queryByText(/Restored 253 records/)).not.toBeInTheDocument();
  });

  it("does not restore imported data when the native file picker is cancelled", async () => {
    vi.mocked(native.pickDataBackup).mockResolvedValueOnce(null);
    await open();
    fireEvent.click(screen.getByText("Backup and restore"));
    const picker = await screen.findByRole("button", {
      name: "Import backup from file",
    });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    await waitFor(() => expect(native.pickDataBackup).toHaveBeenCalledOnce());
    expect(native.restoreDataBackup).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits for draft readiness around restoration and retries failed recovery reads without writing old drafts", async () => {
    const info = {
      id: "notes-backup-test.json",
      createdAt: first.updatedAt,
      notes: 1,
      trashed: 0,
      drafts: 0,
      bytes: 1024,
    };
    vi.mocked(native.listDataBackups).mockResolvedValueOnce([info]);
    vi.mocked(native.previewDataBackup).mockResolvedValueOnce({
      info,
      schemaVersion: 2,
      sampleTitles: [first.title],
    });
    const restoration =
      deferred<Awaited<ReturnType<typeof native.restoreDataBackup>>>();
    vi.mocked(native.restoreDataBackup).mockReturnValueOnce(
      restoration.promise,
    );
    const previousWrite = deferred<void>();
    vi.mocked(native.saveNoteDraft).mockReturnValueOnce(previousWrite.promise);
    const initialDraft =
      deferred<Awaited<ReturnType<typeof native.loadNoteDraft>>>();
    vi.mocked(native.loadNoteDraft).mockReturnValueOnce(initialDraft.promise);
    await open();
    fireEvent.click(screen.getByText("Backup and restore"));
    expect(
      screen.getByRole("button", { name: "Create full backup" }),
    ).toBeDisabled();
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview backup" }),
    );
    const restore = within(await screen.findByRole("dialog")).getByRole(
      "button",
      { name: "Restore this backup" },
    );
    expect(restore).toBeDisabled();
    expect(native.saveNoteDraft).not.toHaveBeenCalled();
    await act(async () => initialDraft.resolve(null));
    expect(restore).toBeEnabled();
    fireEvent.click(restore);
    expect(screen.getByTestId("note-title")).toBeDisabled();
    expect(screen.getByTestId("note-body")).toBeDisabled();
    expect(native.restoreDataBackup).not.toHaveBeenCalled();
    await act(async () => previousWrite.resolve());
    await waitFor(() =>
      expect(native.restoreDataBackup).toHaveBeenCalledOnce(),
    );
    const recovered =
      deferred<Awaited<ReturnType<typeof native.loadNoteDraft>>>();
    vi.mocked(native.loadNoteDraft).mockReturnValueOnce(recovered.promise);
    await act(async () =>
      restoration.resolve({ restored: 1, safetyBackup: info }),
    );
    await waitFor(() => expect(native.loadNoteDraft).toHaveBeenCalledTimes(2));
    vi.mocked(native.saveNoteDraft).mockClear();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(native.saveNoteDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("note-body")).toBeDisabled();
    await act(async () => recovered.reject({ code: "STORAGE_IO" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(body()).toHaveValue("");
    expect(body()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create full backup" }),
    ).toBeDisabled();
    expect(native.saveNoteDraft).not.toHaveBeenCalled();
    vi.mocked(native.loadNoteDraft).mockResolvedValueOnce({
      noteId: 1,
      title: first.title,
      body: "Restored unsaved work",
      expectedVersion: 1,
      originalTitle: first.title,
      originalBody: first.body,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByTestId("note-title")).not.toBeDisabled(),
    );
    expect(body()).toHaveValue("Restored unsaved work");
    expect(native.restoreDataBackup).toHaveBeenCalledOnce();
  });

  it("allows a deleted remote note to be saved as a separate local copy", async () => {
    await open();
    fireEvent.click(await screen.findByText("First note"));
    fireEvent.change(body(), { target: { value: "Rescue this draft" } });
    vi.mocked(native.updateNote).mockRejectedValueOnce({ code: "NOT_FOUND" });
    fireEvent.submit(form());
    const copy = await screen.findByRole("button", { name: "Save as a copy" });
    vi.mocked(native.createNote).mockResolvedValueOnce({
      ...first,
      id: 10,
      body: "Rescue this draft",
    });
    fireEvent.click(copy);
    await waitFor(() =>
      expect(native.createNote).toHaveBeenCalledWith({
        title: first.title,
        body: "Rescue this draft",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
  });

  it("preserves unread drafts after startup errors and ignores old reads after recovery retries", async () => {
    const startup =
      deferred<Awaited<ReturnType<typeof native.loadNoteDraft>>>();
    vi.mocked(native.loadNoteDraft).mockReturnValueOnce(startup.promise);
    vi.mocked(native.onNotesChanged).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    await open();
    await screen.findByRole("alert");
    await waitFor(() => expect(native.loadNoteDraft).toHaveBeenCalledOnce());
    await act(async () => new Promise((done) => setTimeout(done, 250)));
    expect(native.saveNoteDraft).not.toHaveBeenCalled();
    vi.mocked(native.loadNoteDraft).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(body()).toBeEnabled());
    await act(async () =>
      startup.resolve({
        noteId: first.id,
        title: first.title,
        body: "Outdated startup draft",
        expectedVersion: first.version,
        originalTitle: first.title,
        originalBody: first.body,
      }),
    );
    expect(body()).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

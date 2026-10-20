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
import Database from "./database";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  onNotesChanged: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ language: "en", t: createTranslator(en) }) };
});
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let notes: Note[];
let events: Array<() => void>;
async function open() {
  const view = render(<Database />);
  await waitFor(() => expect(native.listNotes).toHaveBeenCalled());
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
    vi.mocked(native.listNotes).mockImplementation(async () => [...notes]);
    vi.mocked(native.onNotesChanged).mockImplementation(async (handler) => {
      events.push(handler);
      return vi.fn<() => void>();
    });
  });
  afterEach(() => {
    const create = screen.queryByRole("button", { name: "New note" });
    if (create && !create.hasAttribute("disabled")) {
      fireEvent.click(create);
      const discard = screen.queryByRole("button", { name: "Discard changes" });
      if (discard) fireEvent.click(discard);
    }
    cleanup();
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
      expect(native.listNotes).toHaveBeenCalledWith("not matching"),
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
    expect(native.deleteNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const removal = deferred<void>();
    vi.mocked(native.deleteNote).mockReturnValueOnce(removal.promise);
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete",
    });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(native.deleteNote).toHaveBeenCalledExactlyOnceWith(1);
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
    await waitFor(() => expect(native.listNotes).toHaveBeenCalledWith("valid"));
    expect(native.listNotes).not.toHaveBeenCalledWith(oversized);
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
    await waitFor(() => expect(native.listNotes).toHaveBeenCalledWith("new"));
    const count = vi.mocked(native.listNotes).mock.calls.length;
    await act(async () => obsolete());
    expect(native.listNotes).toHaveBeenCalledTimes(count);
    view.unmount();
    const after = vi.mocked(native.listNotes).mock.calls.length;
    await act(async () => events.forEach((handler) => handler()));
    expect(native.listNotes).toHaveBeenCalledTimes(after);
  });
});

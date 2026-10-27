import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import {
  act,
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
import { toast } from "sonner";

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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
  it("shows one draft status with the current UTF-8 size and switches to the real path after saving", async () => {
    workbenchEditor.open([
      { ...selected, id: "draft", path: "", content: "", bytes: 0 },
    ]);
    vi.mocked(native.saveWorkbenchAs).mockResolvedValue({
      ...selected,
      content: "你好🙂",
      bytes: 10,
    });
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("workbench.editor"), {
      target: { value: "你好🙂" },
    });
    expect(screen.getAllByText("workbench.localDraft")).toHaveLength(1);
    expect(screen.queryByText("workbench.dirty")).not.toBeInTheDocument();
    expect(screen.getByText("10 B")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "note.txt · title.help" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "workbench.save" }));
    await waitFor(() =>
      expect(
        screen.queryByText("workbench.localDraft"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(selected.path)).toBeVisible();
    const pathHelp = screen.getByRole("button", {
      name: "note.txt · title.help",
    });
    await act(async () => pathHelp.focus());
    expect(pathHelp).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(selected.path);
  });

  it("keeps dirty status for existing paths and preserves original image sizes", () => {
    workbenchEditor.open([selected]);
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("workbench.editor"), {
      target: { value: "é" },
    });
    expect(screen.getByText("workbench.dirty")).toBeVisible();
    expect(screen.getByText("2 B")).toBeVisible();
    act(() =>
      workbenchEditor.open([
        {
          ...selected,
          id: "image",
          name: "image.png",
          kind: "image",
          content: null,
          bytes: 1234,
        },
      ]),
    );
    expect(screen.getByText(`${(1234).toLocaleString()} B`)).toBeVisible();
  });

  it("keeps JSON validation associated with the editor and opens the full message through keyboard focus", async () => {
    workbenchEditor.open([{ ...selected, kind: "json", content: "{" }]);
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    const editor = screen.getByLabelText("workbench.editor");
    expect(editor).toHaveAccessibleDescription("workbench.invalidJson");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "workbench.invalidJson",
    );
    const details = screen.getByRole("button", {
      name: "workbench.editor · title.help",
    });
    await act(async () => details.focus());
    expect(details).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "workbench.invalidJson",
    );
    fireEvent.change(editor, { target: { value: "{}" } });
    expect(editor).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByRole("button", {
        name: "workbench.editor · title.help",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps a manually selected tab ahead of a delayed search result", async () => {
    const other = { ...selected, id: "file-2", name: "other.txt" };
    workbenchEditor.open([selected, other]);
    let finish!: (document: typeof selected) => void;
    vi.mocked(native.loadWorkbenchDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MemoryRouter initialEntries={["/workbench?file=search-result"]}>
        <Workbench />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(native.loadWorkbenchDocument).toHaveBeenCalledWith(
        "search-result",
      ),
    );
    act(() => workbenchEditor.select(other.id));
    await act(async () => finish({ ...selected, id: "search-result" }));
    expect(workbenchEditor.getSnapshot().selectedId).toBe(other.id);
  });

  it("waits for an in-flight operation before opening a search result and preserves edits", async () => {
    workbenchEditor.open([selected]);
    workbenchEditor.edit(selected.id, "local work");
    workbenchEditor.beginOperation();
    vi.mocked(native.loadWorkbenchDocument).mockResolvedValue({
      ...selected,
      content: "remote work",
      revision: "v2",
    });
    render(
      <MemoryRouter initialEntries={["/workbench?file=file-1"]}>
        <Workbench />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(native.loadWorkbenchDocument).not.toHaveBeenCalled();
    act(() => workbenchEditor.finishOperation());
    await waitFor(() =>
      expect(native.loadWorkbenchDocument).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(workbenchEditor.getSnapshot().entries[0]?.remoteChanged).toBe(
        true,
      ),
    );
    expect(screen.getByLabelText("workbench.editor")).toHaveValue("local work");
  });

  it("consumes failed search requests so the same result can be retried", async () => {
    function SearchNavigation() {
      const navigate = useNavigate();
      const location = useLocation();
      return (
        <>
          <button onClick={() => void navigate("/workbench?file=file-1")}>
            Search file
          </button>
          <output data-testid="search-location">{location.search}</output>
        </>
      );
    }
    vi.mocked(native.loadWorkbenchDocument)
      .mockRejectedValueOnce({ code: "STORAGE_IO" })
      .mockResolvedValueOnce(selected);
    render(
      <MemoryRouter initialEntries={["/workbench?file=file-1"]}>
        <SearchNavigation />
        <Workbench />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("search-location")).toHaveTextContent(/^$/),
    );
    fireEvent.click(screen.getByRole("button", { name: "Search file" }));
    await waitFor(() =>
      expect(native.loadWorkbenchDocument).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByLabelText("workbench.editor")).toHaveValue(
      "original",
    );
  });

  it("keeps an in-flight save locked across route remounts", async () => {
    workbenchEditor.open([selected]);
    workbenchEditor.edit(selected.id, "saved edit");
    let finish!: (document: typeof selected) => void;
    vi.mocked(native.saveWorkbenchDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "workbench.save" }));
    view.unmount();
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("workbench.editor")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "workbench.save" }),
    ).toBeDisabled();
    await act(async () =>
      finish({ ...selected, content: "saved edit", revision: "v2" }),
    );
    expect(screen.getByLabelText("workbench.editor")).toBeEnabled();
    expect(screen.getByLabelText("workbench.editor")).toHaveValue("saved edit");
    expect(native.saveWorkbenchDocument).toHaveBeenCalledOnce();
  });

  it("locks the editor for a lifecycle save until the native write finishes", async () => {
    workbenchEditor.open([selected]);
    workbenchEditor.edit(selected.id, "saved edit");
    let finish!: (document: typeof selected) => void;
    vi.mocked(native.saveWorkbenchDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    let saving!: Promise<void>;
    act(() => {
      saving = lifecycle.work!.save();
    });
    expect(screen.getByLabelText("workbench.editor")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "workbench.close note.txt" }),
    ).toBeDisabled();
    await act(async () => {
      finish({ ...selected, content: "saved edit", revision: "v2" });
      await saving;
    });
    expect(screen.getByLabelText("workbench.editor")).toBeEnabled();
    expect(workbenchEditor.hasUnsavedChanges()).toBe(false);
  });

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
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
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
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
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
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("workbench.imported", {
        action: { label: "workbench.openNotes", onClick: expect.any(Function) },
      }),
    );
    expect(
      screen.queryByRole("link", { name: "workbench.openNotes" }),
    ).not.toBeInTheDocument();
    expect(workbenchEditor.hasUnsavedChanges()).toBe(true);
    expect(editor).toHaveValue("note copy");
  });
  it("keeps edits after a conflict and preserves them when save-as is cancelled", async () => {
    vi.mocked(native.saveWorkbenchDocument).mockRejectedValue({
      code: "CONFLICT",
    });
    vi.mocked(native.saveWorkbenchAs).mockResolvedValue(null);
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
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

  it("按需加载磁盘差异，合并后保留本地编辑与新的磁盘 revision", async () => {
    workbenchEditor.open([selected]);
    workbenchEditor.edit(selected.id, "local work");
    vi.mocked(native.loadWorkbenchDocument).mockResolvedValue({
      ...selected,
      content: "disk work",
      revision: "v2",
    });
    render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "workbench.reload" }));
    const apply = await screen.findByRole("button", { name: "diff.apply" });
    fireEvent.click(apply);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("workbench.editor")).toHaveValue("local work");
    expect(workbenchEditor.getSnapshot().entries[0]?.document).toMatchObject({
      content: "disk work",
      revision: "v2",
    });
    expect(workbenchEditor.hasUnsavedChanges()).toBe(true);
  });

  it("retains a save callback after navigation and blocks lifecycle completion when a new-file dialog is cancelled", async () => {
    workbenchEditor.open([
      { ...selected, id: "draft-1", path: "", content: "" },
    ]);
    workbenchEditor.edit("draft-1", "do not lose me");
    vi.mocked(native.saveWorkbenchAs).mockResolvedValue(null);
    const view = render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
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
    const view = render(
      <MemoryRouter>
        <Workbench />
      </MemoryRouter>,
    );
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

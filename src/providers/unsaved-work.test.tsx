import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import {
  UnsavedWorkProvider,
  useUnsavedWork,
  type UnsavedWork,
} from "./unsaved-work";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  setWindowWorkState: vi.fn(async () => {}),
  respondLifecycle: vi.fn(async () => {}),
  onLifecycleRequest: vi.fn(),
  onLifecycleFinished: vi.fn(),
  onLifecycleExecuting: vi.fn(async () => () => {}),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
function Work({ work }: { work: UnsavedWork }) {
  useUnsavedWork(work);
  return null;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("unsaved work lifecycle", () => {
  let request: ((value: native.LifecycleRequest) => void) | undefined;
  let finished: ((id: number) => void) | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(native.onLifecycleRequest).mockImplementation(async (handler) => {
      request = handler;
      return () => {};
    });
    vi.mocked(native.onLifecycleFinished).mockImplementation(
      async (handler) => {
        finished = handler;
        return () => {};
      },
    );
  });
  afterEach(cleanup);
  it("closes on a native cancellation broadcast and ignores a delayed copy of the finished request", async () => {
    render(
      <UnsavedWorkProvider>
        <Work
          work={{
            id: "notes",
            label: "Notes",
            dirty: true,
            save: vi.fn(),
            discard: vi.fn(),
          }}
        />
      </UnsavedWorkProvider>,
    );
    act(() =>
      request?.({ id: 8, action: "quit", windows: ["main", "secondary"] }),
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-lifecycle-request",
      "8",
    );
    act(() => finished?.(8));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    act(() =>
      request?.({ id: 8, action: "quit", windows: ["main", "secondary"] }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => finished?.(9));
    act(() => request?.({ id: 9, action: "quit", windows: ["main"] }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => request?.({ id: 10, action: "quit", windows: ["main"] }));
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-lifecycle-request",
      "10",
    );
  });
  it("retains work after leaving the page and waits for its save before approving", async () => {
    const saving = deferred();
    const save = vi.fn<(signal?: AbortSignal) => Promise<void>>(
      () => saving.promise,
    );
    const work = {
      id: "notes",
      label: "Notes",
      dirty: true,
      save,
      discard: vi.fn(),
    };
    const view = render(
      <UnsavedWorkProvider>
        <Work work={work} />
      </UnsavedWorkProvider>,
    );
    await waitFor(() =>
      expect(native.setWindowWorkState).toHaveBeenCalledWith(["Notes"]),
    );
    view.rerender(
      <UnsavedWorkProvider>
        <span>Another page</span>
      </UnsavedWorkProvider>,
    );
    act(() =>
      request?.({ id: 7, action: "quit", windows: ["main", "secondary"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(save).toHaveBeenCalledOnce();
    const signal = save.mock.calls[0]?.[0];
    act(() =>
      request?.({ id: 7, action: "quit", windows: ["main", "secondary"] }),
    );
    expect(signal?.aborted).toBe(false);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(native.respondLifecycle).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    await waitFor(() =>
      expect(native.respondLifecycle).toHaveBeenCalledWith(7, true),
    );
  });
  it("keeps failed work and the dialog open, then allows cancellation", async () => {
    const save = vi.fn(async () => {
      throw new Error("Disk is full");
    });
    render(
      <UnsavedWorkProvider>
        <Work
          work={{
            id: "files",
            label: "Files",
            dirty: true,
            save,
            discard: vi.fn(),
          }}
        />
      </UnsavedWorkProvider>,
    );
    act(() =>
      request?.({ id: 2, action: "install-update", windows: ["main"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk is full");
    expect(native.respondLifecycle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(native.respondLifecycle).toHaveBeenCalledWith(2, false),
    );
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Files"]);
  });
  it("awaits durable draft removal before approving discard", async () => {
    const removing = deferred();
    const discard = vi.fn(() => removing.promise);
    render(
      <UnsavedWorkProvider>
        <Work
          work={{
            id: "notes",
            label: "Notes",
            dirty: true,
            save: vi.fn(),
            discard,
          }}
        />
      </UnsavedWorkProvider>,
    );
    act(() => request?.({ id: 3, action: "close", windows: ["secondary"] }));
    fireEvent.click(
      screen.getByRole("button", { name: "Discard and continue" }),
    );
    expect(discard).toHaveBeenCalledOnce();
    expect(native.respondLifecycle).not.toHaveBeenCalled();
    await act(async () => removing.resolve());
    await waitFor(() =>
      expect(native.respondLifecycle).toHaveBeenCalledWith(3, true),
    );
  });
});

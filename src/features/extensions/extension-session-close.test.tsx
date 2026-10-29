import { createRef, type ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ExtensionSessionClose,
  type ExtensionSessionCloseHandle,
} from "./extension-session-close";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderClose(
  props: Partial<ComponentProps<typeof ExtensionSessionClose>> = {},
) {
  const handle = createRef<ExtensionSessionCloseHandle>();
  const returnFocusRef = createRef<HTMLButtonElement>();
  const onSave = vi.fn<(signal: AbortSignal) => Promise<void>>();
  const onClose = vi.fn<(signal: AbortSignal) => Promise<void>>();
  onSave.mockResolvedValue(undefined);
  onClose.mockResolvedValue(undefined);
  const result = render(
    <>
      <button
        ref={returnFocusRef}
        onClick={() => handle.current?.requestClose()}
      >
        Session tools
      </button>
      <ExtensionSessionClose
        ref={handle}
        dirty={false}
        busy={false}
        disabled={false}
        onSave={onSave}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
        {...props}
      />
    </>,
  );
  return {
    ...result,
    handle,
    onSave,
    onClose,
    tools: screen.getByRole("button", { name: "Session tools" }),
  };
}

afterEach(cleanup);

it("ends a clean session imperatively without exporting or opening confirmation", async () => {
  const closing = deferred();
  const onClose = vi.fn(() => closing.promise);
  const { handle, onSave } = renderClose({ onClose });

  act(() => {
    handle.current?.requestClose();
    handle.current?.requestClose();
  });

  expect(onClose).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "End session" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    closing.resolve();
    await closing.promise;
  });
});

it("ignores imperative close requests while the session is disabled", () => {
  const { handle, tools, onSave, onClose } = renderClose({
    disabled: true,
    dirty: true,
  });

  act(() => handle.current?.requestClose());
  fireEvent.click(tools);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it.each([
  { dirty: true, busy: false },
  { dirty: false, busy: true },
])(
  "requires confirmation when dirty=$dirty and busy=$busy, and returns focus on cancellation",
  async (state) => {
    const { handle, tools, onSave, onClose } = renderClose(state);
    tools.focus();

    act(() => handle.current?.requestClose());

    expect(
      screen.getByRole("dialog", { name: "End this session?" }),
    ).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(tools).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  },
);

it("waits for the export before ending and ignores repeated requests while saving", async () => {
  const saving = deferred();
  const onSave = vi.fn<(signal: AbortSignal) => Promise<void>>(
    () => saving.promise,
  );
  const { handle, onClose, tools } = renderClose({ dirty: true, onSave });
  fireEvent.click(tools);
  fireEvent.click(screen.getByRole("button", { name: "Export and end" }));

  act(() => handle.current?.requestClose());
  expect(onSave).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Export and end" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Discard and end" }),
  ).toBeDisabled();

  await act(async () => {
    saving.resolve();
    await saving.promise;
  });

  expect(onClose).toHaveBeenCalledExactlyOnceWith(onSave.mock.calls[0]?.[0]);
  expect(onSave.mock.calls[0]?.[0].aborted).toBe(false);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(tools).toHaveFocus());
});

it("aborts a cancelled export and never ends the session when that export completes late", async () => {
  const saving = deferred();
  const onSave = vi.fn<(signal: AbortSignal) => Promise<void>>(
    () => saving.promise,
  );
  const { handle, onClose, tools } = renderClose({ dirty: true, onSave });
  fireEvent.click(tools);
  fireEvent.click(screen.getByRole("button", { name: "Export and end" }));
  const signal = onSave.mock.calls[0]?.[0];

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(signal?.aborted).toBe(true);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(tools).toHaveFocus());
  act(() => handle.current?.requestClose());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await act(async () => {
    saving.resolve();
    await saving.promise;
  });

  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(tools);
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("retains the confirmation after a failed export and permits discarding instead", async () => {
  const onSave = vi.fn().mockRejectedValue(new Error("Export unavailable"));
  const { onClose, tools } = renderClose({ dirty: true, onSave });
  fireEvent.click(tools);
  fireEvent.click(screen.getByRole("button", { name: "Export and end" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Export unavailable",
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard and end" }));

  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(onSave).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  await waitFor(() => expect(tools).toHaveFocus());
});

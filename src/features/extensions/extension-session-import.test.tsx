import { useRef, useState, type ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { ExtensionSessionImport } from "./extension-session-import";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  validateExtensionView: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
const item: native.ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: [],
  package: {
    bytes: 100,
    sha256: "a".repeat(64),
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "example.import",
      name: "Import",
      version: "1.0.0",
      author: "Example",
      description: "Example",
      commands: [
        {
          id: "open",
          title: "Open",
          function: "open",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
        },
      ],
      permissions: [],
      optionalPermissions: [],
      network: [],
    },
  },
};
const view: native.ExtensionView = {
  version: 2,
  state: "state",
  display: "Imported",
  description: "",
  fields: [],
  groups: [],
};
function file() {
  const content = JSON.stringify({
    formatVersion: 1,
    kind: "view",
    extensionId: "example.import",
    extensionVersion: "1.0.0",
    commandId: "open",
    sha256: item.package.sha256,
    inputText: "",
    files: [],
    url: "",
    fields: {},
    view,
    result: null,
  });
  const selected = new File([content], "session.json", {
    type: "application/json",
  });
  selected.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
  return selected;
}
function ImportMenu(props: ComponentProps<typeof ExtensionSessionImport>) {
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={returnFocusRef} onClick={() => setOpen(!open)}>
        Extension tools
      </button>
      {open ? (
        <div role="menu">
          <button
            role="menuitem"
            onClick={() => {
              inputRef.current?.click();
              setOpen(false);
            }}
          >
            Import session
          </button>
        </div>
      ) : null}
      <ExtensionSessionImport
        {...props}
        presentation="hidden"
        inputRef={inputRef}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("identifies late completion by its original promise so an owner can retain a newer pending selection", async () => {
  let finishOld!: (view: native.ExtensionView) => void;
  let finishNew!: (view: native.ExtensionView) => void;
  vi.mocked(native.validateExtensionView)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishNew = resolve;
      }),
    );
  const onPending =
    vi.fn<(promise: Promise<void> | null, completed?: Promise<void>) => void>();
  const onRestore = vi.fn();
  const props = {
    item,
    commandId: "open",
    kind: "view" as const,
    blocked: false,
    onPending,
    onRestore,
    onError: vi.fn(),
  };
  const old = render(<ExtensionSessionImport {...props} />);
  fireEvent.change(screen.getByLabelText("Import session"), {
    target: { files: [file()] },
  });
  await waitFor(() =>
    expect(native.validateExtensionView).toHaveBeenCalledTimes(1),
  );
  const oldPending = onPending.mock.calls[0]?.[0];
  expect(oldPending).toBeInstanceOf(Promise);
  old.unmount();
  render(<ExtensionSessionImport {...props} />);
  fireEvent.change(screen.getByLabelText("Import session"), {
    target: { files: [file()] },
  });
  await waitFor(() =>
    expect(native.validateExtensionView).toHaveBeenCalledTimes(2),
  );
  const newPending = onPending.mock.calls[1]?.[0];
  expect(newPending).toBeInstanceOf(Promise);
  expect(newPending).not.toBe(oldPending);
  await act(async () => {
    finishOld(view);
    await oldPending;
  });
  expect(onPending).toHaveBeenLastCalledWith(null, oldPending);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => {
    finishNew(view);
    await newPending;
  });
  expect(onPending).toHaveBeenLastCalledWith(null, newPending);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(onRestore).not.toHaveBeenCalled();
});

it.each(["Cancel", "Replace session"])(
  "keeps a hidden import mounted after its menu item closes and returns %s to the menu trigger",
  async (action) => {
    let finish!: (value: native.ExtensionView) => void;
    vi.mocked(native.validateExtensionView).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onRestore = vi.fn();
    const onError = vi.fn();
    const onPending = vi.fn();
    render(
      <ImportMenu
        item={item}
        commandId="open"
        kind="view"
        blocked={false}
        onRestore={onRestore}
        onError={onError}
        onPending={onPending}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Import session");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".json,application/json");
    expect(input).not.toBeVisible();
    const chooseFile = vi.spyOn(input, "click");
    const menuTrigger = screen.getByRole("button", { name: "Extension tools" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Import session" }));
    expect(chooseFile).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Import session")).toBe(input);
    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() =>
      expect(native.validateExtensionView).toHaveBeenCalledOnce(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      finish(view);
      await onPending.mock.calls[0]?.[0];
    });
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(menuTrigger).toHaveFocus());
    if (action === "Cancel") expect(onRestore).not.toHaveBeenCalled();
    else
      expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ view }));
    expect(onError).not.toHaveBeenCalled();
  },
);

it("keeps the default import field visible and restores its focus after review", async () => {
  vi.mocked(native.validateExtensionView).mockResolvedValueOnce(view);
  const returnFocusRef = { current: document.createElement("button") };
  const onPending = vi.fn();
  render(
    <ExtensionSessionImport
      item={item}
      commandId="open"
      kind="view"
      blocked={false}
      onRestore={vi.fn()}
      onError={vi.fn()}
      onPending={onPending}
      returnFocusRef={returnFocusRef}
    />,
  );
  const input = screen.getByLabelText("Import session");
  expect(input).toBeVisible();
  fireEvent.change(input, { target: { files: [file()] } });
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(input).toHaveFocus());
});

it("keeps hidden file imports disabled while the session is blocked", () => {
  const inputRef = { current: null as HTMLInputElement | null };
  const onPending = vi.fn();
  render(
    <ExtensionSessionImport
      item={item}
      commandId="open"
      kind="view"
      blocked
      presentation="hidden"
      inputRef={inputRef}
      onRestore={vi.fn()}
      onError={vi.fn()}
      onPending={onPending}
    />,
  );
  expect(inputRef.current).toBe(screen.getByLabelText("Import session"));
  expect(inputRef.current).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Import session"), {
    target: { files: [file()] },
  });
  expect(onPending).not.toHaveBeenCalled();
  expect(native.validateExtensionView).not.toHaveBeenCalled();
});

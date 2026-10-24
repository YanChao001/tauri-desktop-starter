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
  fireEvent.change(screen.getByLabelText("Import session JSON"), {
    target: { files: [file()] },
  });
  await waitFor(() =>
    expect(native.validateExtensionView).toHaveBeenCalledTimes(1),
  );
  const oldPending = onPending.mock.calls[0]?.[0];
  expect(oldPending).toBeInstanceOf(Promise);
  old.unmount();
  render(<ExtensionSessionImport {...props} />);
  fireEvent.change(screen.getByLabelText("Import session JSON"), {
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

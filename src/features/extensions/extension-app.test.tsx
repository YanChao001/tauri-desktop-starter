import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { UnsavedWork } from "@/providers/unsaved-work";
import { ExtensionApp } from "./extension-app";
import { ExtensionsProvider } from "./extensions-provider";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  viewExtension: vi.fn(),
  cancelExtension: vi.fn(),
  saveTextExport: vi.fn(),
  pickExtensionFiles: vi.fn(),
  validateExtensionView: vi.fn(),
  saveExtensionArtifact: vi.fn(),
  getCurrentWindowLabel: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
const lifecycle = vi.hoisted(() => ({ work: null as UnsavedWork | null }));
vi.mock("@/providers/unsaved-work", () => ({
  useUnsavedWork: (work: UnsavedWork) => {
    lifecycle.work = work;
  },
}));
const item: native.ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  package: {
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      id: "third-party.form",
      version: "1.0.0",
      name: "Custom app",
      author: "Example",
      description: "Third party view",
      commands: [
        {
          id: "open",
          title: "Open",
          function: "app",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
        },
      ],
      permissions: [],
      minHostVersion: "0.1.0",
      optionalPermissions: [],
      network: [],
    },
    sha256: "a".repeat(64),
    bytes: 100,
  },
  enabled: true,
  grantedPermissions: [],
};
const first: native.ExtensionView = {
  version: 2,
  state: "opaque state",
  display: "<script>plain text</script>",
  description: "Plugin controls this view",
  fields: [{ id: "query", label: "Query", value: "Original", maxBytes: 2048 }],
  groups: [
    {
      columns: 1,
      actions: [
        { id: "submit", label: "Submit", primary: true, disabled: false },
      ],
    },
  ],
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
const onClose = vi.fn(),
  onSettled = vi.fn().mockResolvedValue(undefined);
function app(runningId: string | null = null) {
  return (
    <ExtensionApp
      item={item}
      commandId="open"
      runs={
        runningId ? [{ id: runningId, owner: "browser", phase: "running" }] : []
      }
      onClose={onClose}
      onSettled={onSettled}
    />
  );
}
function openSessionTools() {
  if (!screen.queryByRole("region", { name: "Extension tools" }))
    fireEvent.click(screen.getByRole("button", { name: "Extension tools" }));
}
function sessionButton(name: string) {
  openSessionTools();
  return screen.getByRole("button", { name });
}
beforeEach(() => {
  vi.clearAllMocks();
  lifecycle.work = null;
  vi.mocked(native.viewExtension).mockResolvedValue(first);
  vi.mocked(native.cancelExtension).mockResolvedValue(undefined);
  vi.mocked(native.saveTextExport).mockResolvedValue("saved.json");
  vi.mocked(native.getCurrentWindowLabel).mockResolvedValue("browser");
});
afterEach(cleanup);

it("renders third-party controls as text and sends one initialized request in StrictMode", async () => {
  render(<StrictMode>{app()}</StrictMode>);
  await screen.findByRole("button", { name: "Submit" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.querySelector("[data-slot=dialog-overlay]")).toBeNull();
  expect(native.viewExtension).toHaveBeenCalledTimes(1);
  expect(native.viewExtension).toHaveBeenCalledWith({
    id: item.package.manifest.id,
    commandId: "open",
    expectedSha256: item.package.sha256,
    expectedGeneration: item.generation,
    data: undefined,
    request: {
      version: 2,
      host: null,
      results: [],
      action: null,
      state: "",
      fields: {},
      locale: "en",
    },
  });
  expect(screen.getByText("<script>plain text</script>")).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  const result = screen.getByRole("status", { name: "Result" });
  result.focus();
  expect(result).toHaveFocus();
});

it("keeps session tools out of the main workflow and preserves a draft when ending is cancelled", async () => {
  render(app());
  const input = await screen.findByLabelText("Query");
  expect(
    screen.queryByText("Export session", { selector: "button" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Request stop", { selector: "button" }),
  ).not.toBeVisible();
  fireEvent.change(input, { target: { value: "Keep my progress" } });
  const end = sessionButton("End session");
  fireEvent.click(end);
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(input).toHaveValue("Keep my progress");
  expect(end).toHaveFocus();
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(native.cancelExtension).not.toHaveBeenCalled();
});

it("retains progress when session export is cancelled and only ends after a successful export", async () => {
  vi.mocked(native.saveTextExport)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("session.json");
  render(app());
  const input = await screen.findByLabelText("Query");
  fireEvent.change(input, { target: { value: "Export before ending" } });
  fireEvent.click(sessionButton("End session"));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Export session and end" }),
  );
  await within(dialog).findByRole("alert");
  expect(input).toHaveValue("Export before ending");
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Export session and end" }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(native.saveTextExport).toHaveBeenLastCalledWith(
    "third-party.form-session.json",
    expect.stringContaining("Export before ending"),
  );
  expect(lifecycle.work?.dirty).toBe(false);
});

it("cancels a pending export-and-end decision without clearing the session after the file picker returns", async () => {
  const exporting = deferred<string | null>();
  vi.mocked(native.saveTextExport).mockReturnValueOnce(exporting.promise);
  render(app());
  const input = await screen.findByLabelText("Query");
  fireEvent.change(input, { target: { value: "Keep after abort" } });
  fireEvent.click(sessionButton("End session"));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Export session and end" }),
  );
  await waitFor(() => expect(native.saveTextExport).toHaveBeenCalledOnce());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await act(async () => exporting.resolve("saved.json"));
  expect(input).toHaveValue("Keep after abort");
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  const end = sessionButton("End session");
  expect(end).toBeEnabled();
  expect(end).toHaveFocus();
  fireEvent.click(end);
  expect(
    await screen.findByRole("dialog", { name: "End this session?" }),
  ).toBeVisible();
});
it("serializes actions and preserves both input and the previous view after failure", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce({ code: "EXTENSION_RUN_FAILED" });
  render(app());
  const submit = await screen.findByRole("button", { name: "Submit" });
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Typed" },
  });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(native.viewExtension).toHaveBeenCalledTimes(2);
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: {
        version: 2,
        host: null,
        results: [],
        action: "submit",
        state: "opaque state",
        fields: { query: "Typed" },
        locale: "en",
      },
    }),
  );
  expect(submit).toHaveAttribute("aria-disabled", "true");
  await act(async () =>
    pending.resolve({
      ...first,
      state: "next state",
      display: "Complete",
      fields: [{ id: "query", label: "Query", value: "Typed" }],
    }),
  );
  fireEvent.click(submit);
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Query")).toHaveValue("Typed");
  expect(screen.getByText("Complete")).toBeVisible();
  expect(lifecycle.work?.dirty).toBe(true);
});

it("keeps feedback and footer controls mounted across running, stopping and settled states", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  const mounted = render(app());
  const submit = await screen.findByRole("button", { name: "Submit" });
  const stop = screen.getByText("Request stop", { selector: "button" });
  const end = sessionButton("End session");
  const status = screen.getByRole("status", { name: "Execution status" });
  expect(stop).toBeDisabled();
  expect(status).toBeEmptyDOMElement();
  fireEvent.click(submit);
  expect(stop).toBeEnabled();
  expect(status).toHaveTextContent("Working…");
  fireEvent.click(stop);
  expect(status).toHaveTextContent("Waiting for the extension to stop…");
  expect(stop).toBeDisabled();
  await act(async () => pending.resolve(first));
  expect(screen.getByText("Request stop", { selector: "button" })).toBe(stop);
  expect(sessionButton("End session")).toBe(end);
  expect(screen.getByRole("status", { name: "Execution status" })).toBe(status);
  expect(status).toBeEmptyDOMElement();
  expect(stop).toBeDisabled();
  mounted.rerender(app("test.other"));
  expect(status).toBeEmptyDOMElement();
  expect(submit).toHaveAttribute("aria-disabled", "false");
  expect(stop).toBeDisabled();
});
it("shows queued status for this window and lets the user cancel its waiting operation", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  const mounted = render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
  mounted.rerender(
    <ExtensionApp
      item={item}
      commandId="open"
      runs={[
        { id: item.package.manifest.id, owner: "browser", phase: "queued" },
      ]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Execution status" }),
    ).toHaveTextContent("Queued, waiting for a runtime slot…"),
  );
  fireEvent.click(screen.getByText("Request stop", { selector: "button" }));
  await waitFor(() =>
    expect(native.cancelExtension).toHaveBeenCalledWith(
      item.package.manifest.id,
      item.generation,
    ),
  );
  await act(async () => pending.reject({ code: "USER_CANCELLED" }));
});
it("waits for native completion before ending a session and clears its unsaved registration", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
  fireEvent.click(sessionButton("End session"));
  const confirmation = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  expect(native.cancelExtension).not.toHaveBeenCalled();
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Discard and end" }),
  );
  await waitFor(() =>
    expect(native.cancelExtension).toHaveBeenCalledWith("third-party.form", 1),
  );
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve(first));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(lifecycle.work?.dirty).toBe(false);
});
it("exports a final result after detaching, and an aborted discard preserves state", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  const mounted = render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const work = lifecycle.work!;
  mounted.unmount();
  const saving = work.save();
  await act(async () => {
    pending.resolve({
      ...first,
      state: "completed after detach",
      display: "Final",
    });
    await saving;
  });
  expect(native.saveTextExport).toHaveBeenCalledWith(
    "third-party.form-session.json",
    expect.stringContaining("completed after detach"),
  );
  const controller = new AbortController();
  controller.abort();
  await expect(work.discard(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await work.save();
  expect(native.saveTextExport).toHaveBeenLastCalledWith(
    "third-party.form-session.json",
    expect.stringContaining("completed after detach"),
  );
});

it("restores the same view and edited fields when navigating away and back within a host window", async () => {
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <ExtensionsProvider>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : <p>Other page</p>}
      </ExtensionsProvider>
    );
  }
  render(<Workspace />);
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Retained draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByText("Other page")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByLabelText("Query")).toHaveValue("Retained draft");
  expect(native.viewExtension).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        fields: { query: "Retained draft" },
        state: "opaque state",
      }),
    }),
  );
});

it("keeps a session locked when returning while its export is still pending", async () => {
  const exporting = deferred<string | null>();
  vi.mocked(native.saveTextExport).mockReturnValueOnce(exporting.promise);
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <ExtensionsProvider>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : <p>Other page</p>}
      </ExtensionsProvider>
    );
  }
  render(<Workspace />);
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Export this draft" },
  });
  fireEvent.click(sessionButton("Export session"));
  await waitFor(() => expect(native.saveTextExport).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByLabelText("Query")).toHaveValue("Export this draft");
  expect(screen.getByLabelText("Query")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(sessionButton("Export session")).toBeDisabled();
  expect(sessionButton("End session")).toBeDisabled();
  await act(async () => exporting.resolve("saved.json"));
  await waitFor(() => expect(screen.getByLabelText("Query")).toBeEnabled());
  expect(lifecycle.work?.dirty).toBe(false);
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Next edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByLabelText("Query")).toHaveValue("Next edit");
  expect(lifecycle.work?.dirty).toBe(true);
  expect(native.viewExtension).toHaveBeenCalledOnce();
});

it("reports the UTF-8 field limit before invoking Wasm and allows correcting the input", async () => {
  render(app());
  const input = await screen.findByLabelText("Query");
  fireEvent.change(input, { target: { value: "中".repeat(683) } });
  expect(input).toBeInvalid();
  expect(input).toHaveAccessibleDescription(
    "Each field accepts up to 2048 UTF-8 bytes.",
  );
  expect(input).toBeEnabled();
  const submit = screen.getByRole("button", { name: "Submit" });
  expect(submit).toHaveAttribute("aria-disabled", "true");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { value: "中".repeat(682) } });
  expect(input).not.toBeInvalid();
  expect(submit).toHaveAttribute("aria-disabled", "false");
  fireEvent.click(submit);
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ fields: { query: "中".repeat(682) } }),
    }),
  );
});

it("preserves the draft and unlocks a remounted session when its export is cancelled", async () => {
  const exporting = deferred<string | null>();
  vi.mocked(native.saveTextExport).mockReturnValueOnce(exporting.promise);
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <ExtensionsProvider>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : <p>Other page</p>}
      </ExtensionsProvider>
    );
  }
  render(<Workspace />);
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Keep this draft after cancellation" },
  });
  fireEvent.click(sessionButton("Export session"));
  await waitFor(() => expect(native.saveTextExport).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  await act(async () => exporting.resolve(null));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Query")).toBeEnabled();
  expect(screen.getByLabelText("Query")).toHaveValue(
    "Keep this draft after cancellation",
  );
  expect(lifecycle.work?.dirty).toBe(true);
  fireEvent.click(sessionButton("Export session"));
  await waitFor(() => expect(native.saveTextExport).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(lifecycle.work?.dirty).toBe(false));
});

it("transfers host data only on explicit send and omits it from ordinary actions", async () => {
  const withData = {
    ...item,
    grantedPermissions: [
      "text:read",
      "network:https",
    ] as native.ExtensionInfo["grantedPermissions"],
  };
  render(
    <ExtensionApp
      item={withData}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await screen.findByRole("button", { name: "Submit" });
  openSessionTools();
  fireEvent.click(screen.getByText("Host data · explicit transfer"));
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "Explicit input" },
  });
  fireEvent.change(screen.getByLabelText("URL for this run (optional)"), {
    target: { value: "https://httpbin.org/get" },
  });
  expect(native.viewExtension).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Send selected data" }));
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: {
        inputText: "Explicit input",
        fileIds: [],
        url: "https://httpbin.org/get",
      },
      request: expect.objectContaining({ action: "host-data" }),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: undefined }),
  );
});

it("omits retained host-data drafts when their optional permissions are revoked", async () => {
  const view = (grantedPermissions: native.ExtensionPermission[]) => (
    <ExtensionApp
      item={{ ...item, grantedPermissions }}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />
  );
  const mounted = render(view(["text:read", "network:https"]));
  await screen.findByRole("button", { name: "Submit" });
  openSessionTools();
  fireEvent.click(screen.getByText("Host data · explicit transfer"));
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "keep text" },
  });
  fireEvent.change(screen.getByLabelText("URL for this run (optional)"), {
    target: { value: "https://service.example/data" },
  });
  mounted.rerender(view(["text:read"]));
  expect(
    screen.queryByLabelText("URL for this run (optional)"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send selected data" }));
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: { inputText: "keep text", fileIds: [], url: null },
    }),
  );
});

it("starts a fresh session for a higher package version even when the Wasm hash is unchanged", async () => {
  function Workspace() {
    const [version, setVersion] = useState("1.0.0");
    const upgraded = {
      ...item,
      package: {
        ...item.package,
        manifest: { ...item.package.manifest, version },
      },
    };
    return (
      <ExtensionsProvider>
        <button onClick={() => setVersion("1.1.0")}>Upgrade</button>
        <ExtensionApp
          key={version}
          item={upgraded}
          commandId="open"
          runs={[]}
          onClose={onClose}
          onSettled={onSettled}
        />
      </ExtensionsProvider>
    );
  }
  render(<Workspace />);
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Old version draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Query")).toHaveValue("Original");
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ state: "", fields: {} }),
    }),
  );
});

it("isolates retained sessions and late cancellation across same-hash installation generations", async () => {
  const late = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(first);
  function Workspace() {
    const [generation, setGeneration] = useState(1);
    return (
      <ExtensionsProvider>
        <button onClick={() => setGeneration(2)}>Replace installation</button>
        <ExtensionApp
          key={generation}
          item={{ ...item, generation }}
          commandId="open"
          runs={[]}
          onClose={onClose}
          onSettled={onSettled}
        />
      </ExtensionsProvider>
    );
  }
  render(<Workspace />);
  const query = await screen.findByLabelText("Query");
  fireEvent.change(query, { target: { value: "Old installation draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace installation" }));
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(3));
  expect(native.cancelExtension).toHaveBeenCalledWith(
    item.package.manifest.id,
    1,
  );
  expect(screen.getByLabelText("Query")).toHaveValue("Original");
  await act(async () =>
    late.resolve({ ...first, display: "Late old installation result" }),
  );
  expect(
    screen.queryByText("Late old installation result"),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Query")).toHaveValue("Original");
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedGeneration: 2 }),
  );
});

it("observes a retained run directly after remount and preserves its failure feedback", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <ExtensionsProvider>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : null}
      </ExtensionsProvider>
    );
  }
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(
    screen.getByText("Request stop", { selector: "button" }),
  ).toBeEnabled();
  expect(lifecycle.work?.dirty).toBe(true);
  await act(async () => pending.reject({ code: "EXTENSION_RUN_FAILED" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  expect(screen.getByLabelText("Query")).toHaveValue("Original");
  expect(native.viewExtension).toHaveBeenCalledTimes(2);
});

it("preserves file choices on picker cancellation and waits for selection before exporting", async () => {
  const document: native.ExtensionFileChoice = {
    id: "chosen-file",
    name: "sample.txt",
    mediaType: "text/plain",
    bytes: 10,
  };
  const selecting = deferred<native.ExtensionFileChoice[]>();
  vi.mocked(native.pickExtensionFiles)
    .mockResolvedValueOnce([document])
    .mockReturnValueOnce(selecting.promise);
  render(
    <ExtensionApp
      item={{ ...item, grantedPermissions: ["files:read"] }}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await screen.findByRole("button", { name: "Submit" });
  openSessionTools();
  fireEvent.click(screen.getByText("Host data · explicit transfer"));
  fireEvent.click(
    screen.getByRole("button", { name: "Choose files for this run" }),
  );
  await screen.findByText("sample.txt");
  fireEvent.click(
    screen.getByRole("button", { name: "Choose files for this run" }),
  );
  expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(sessionButton("Export session")).toBeDisabled();
  expect(sessionButton("End session")).toBeDisabled();
  const saving = lifecycle.work!.save();
  expect(native.saveTextExport).not.toHaveBeenCalled();
  await act(async () => {
    selecting.resolve([]);
    await saving;
  });
  expect(screen.getByText("sample.txt")).toBeVisible();
  expect(native.saveTextExport).toHaveBeenCalledWith(
    "third-party.form-session.json",
    expect.stringContaining('"sample.txt"'),
  );
  expect(lifecycle.work?.dirty).toBe(false);
});

it("requires confirmation before importing a version-bound session and never restores native file IDs", async () => {
  vi.mocked(native.validateExtensionView).mockResolvedValue({
    ...first,
    state: "restored state",
  });
  render(app());
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Current unsaved input" },
  });
  const content = JSON.stringify({
    formatVersion: 1,
    kind: "view",
    extensionId: item.package.manifest.id,
    commandId: "open",
    extensionVersion: "1.0.0",
    sha256: item.package.sha256,
    view: first,
    fields: { query: "Restored input" },
    inputText: "restored host input",
    url: "",
    files: ["reselect.txt"],
    result: null,
  });
  const file = new File([content], "session.json", {
    type: "application/json",
  });
  file.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
  openSessionTools();
  fireEvent.change(screen.getByLabelText("Import session JSON"), {
    target: { files: [file] },
  });
  const dialog = await screen.findByRole("dialog");
  expect(screen.getByLabelText("Query")).toHaveValue("Current unsaved input");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  expect(dialog).toHaveTextContent("reselect.txt");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace current session" }),
  );
  expect(screen.getByLabelText("Query")).toHaveValue("Restored input");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  await act(async () => lifecycle.work!.save());
  const exported = JSON.parse(
    String(vi.mocked(native.saveTextExport).mock.calls.at(-1)?.[1]),
  ) as { files: string[]; fields: Record<string, string> };
  expect(exported.files).toEqual([]);
  expect(exported.fields).toEqual({ query: "Restored input" });
});

it("saves a typed generated artifact only after the user activates its button", async () => {
  const artifact: native.ExtensionArtifact = {
    name: "report.csv",
    mediaType: "text/csv",
    encoding: "utf8",
    content: "name,value\nexample,1",
  };
  vi.mocked(native.viewExtension).mockResolvedValueOnce({
    ...first,
    artifacts: [artifact],
  });
  vi.mocked(native.saveExtensionArtifact).mockResolvedValueOnce("report.csv");
  render(app());
  const save = await screen.findByRole("button", { name: "Save report.csv" });
  expect(native.saveExtensionArtifact).not.toHaveBeenCalled();
  fireEvent.click(save);
  await waitFor(() =>
    expect(native.saveExtensionArtifact).toHaveBeenCalledWith(
      item.package.manifest.id,
      item.package.sha256,
      item.generation,
      artifact,
    ),
  );
});

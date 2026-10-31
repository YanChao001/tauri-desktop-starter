import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as native from "@/lib/tauri";
import type { UnsavedWork } from "@/providers/unsaved-work";
import { ExtensionApp } from "./extension-app";
import { ExtensionsProvider, useExtensions } from "./extensions-provider";
import {
  ExtensionChromeProvider,
  ExtensionChromeSlot,
} from "./extension-chrome-slot";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExtensionActivityProvider } from "./extension-activity";

function render(ui: ReactNode) {
  return renderUi(ui, {
    wrapper: ({ children }) => (
      <ExtensionsProvider>
        <TooltipProvider>
          <ExtensionChromeProvider scope="test-session">
            <nav aria-label="Session navigation">
              <ExtensionChromeSlot placement="navigation" />
            </nav>
            {children}
          </ExtensionChromeProvider>
        </TooltipProvider>
      </ExtensionsProvider>
    ),
  });
}

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  viewExtension: vi.fn(),
  cancelExtension: vi.fn(),
  saveExtensionSession: vi.fn(),
  pickExtensionFiles: vi.fn(),
  validateExtensionView: vi.fn(),
  saveExtensionArtifact: vi.fn(),
  getCurrentWindowLabel: vi.fn(),
  openExtensionUi: vi.fn(),
  closeExtensionUi: vi.fn(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { motion: "full" } }),
}));
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return {
    useI18n: () => ({ t: createTranslator(en), language: locale.language }),
  };
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
  if (!screen.queryByRole("menu", { name: "Extension tools" }))
    fireEvent.keyDown(screen.getByRole("button", { name: "Extension tools" }), {
      key: "ArrowDown",
    });
}
function sessionButton(name: string) {
  openSessionTools();
  return screen.getByRole("menuitem", { name });
}
beforeEach(() => {
  vi.clearAllMocks();
  locale.language = "en";
  lifecycle.work = null;
  vi.mocked(native.viewExtension).mockResolvedValue(first);
  vi.mocked(native.cancelExtension).mockResolvedValue(undefined);
  vi.mocked(native.saveExtensionSession).mockResolvedValue("saved.json");
  vi.mocked(native.getCurrentWindowLabel).mockResolvedValue("browser");
  vi.mocked(native.closeExtensionUi).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

it("shows a prelayout skeleton only while the first Wasm view is pending", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension).mockReturnValueOnce(pending.promise);
  render(app());
  expect(await screen.findByRole("status", { name: "Loading…" })).toBeVisible();
  expect(native.viewExtension).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("heading", { name: item.package.manifest.name }),
  ).not.toBeInTheDocument();
  await act(async () => pending.resolve(first));
  expect(await screen.findByLabelText("Query")).toBeVisible();
  expect(
    screen.queryByRole("status", { name: "Loading…" }),
  ).not.toBeInTheDocument();
});

it("offers a native retry after an HTML document's first Wasm initialization fails", async () => {
  vi.mocked(native.viewExtension)
    .mockRejectedValueOnce({ code: "EXTENSION_RUN_FAILED" })
    .mockResolvedValueOnce(first);
  vi.mocked(native.openExtensionUi).mockResolvedValueOnce({
    url: "extension-ui://surface/retry",
    token: "retry",
  });
  const documentItem = {
    ...item,
    package: {
      ...item.package,
      manifest: {
        ...item.package.manifest,
        commands: item.package.manifest.commands.map((command) => ({
          ...command,
          ui: { sidebar: true, window: true, document: "main" },
        })),
      },
    },
  };
  render(
    <ExtensionApp
      item={documentItem}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
});

it("loads the isolated document in parallel with a pending first Wasm view", async () => {
  const initial = deferred<native.ExtensionView>();
  const lease = deferred<{ url: string; token: string }>();
  vi.mocked(native.viewExtension).mockReturnValueOnce(initial.promise);
  vi.mocked(native.openExtensionUi).mockReturnValueOnce(lease.promise);
  const mounted = render(
    <ExtensionApp
      item={{
        ...item,
        package: {
          ...item.package,
          manifest: {
            ...item.package.manifest,
            commands: item.package.manifest.commands.map((command) => ({
              ...command,
              ui: { sidebar: true, window: true, document: "main" },
            })),
          },
        },
      }}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await waitFor(() => {
    expect(native.viewExtension).toHaveBeenCalledOnce();
    expect(native.openExtensionUi).toHaveBeenCalledOnce();
  });
  await act(async () =>
    lease.resolve({ url: "about:blank", token: "parallel-start" }),
  );
  expect(mounted.container.querySelector("iframe")).toHaveAttribute(
    "src",
    "about:blank",
  );
  expect(screen.getByRole("status", { name: "Loading…" })).toBeVisible();
  await act(async () => initial.resolve(first));
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
});

it("finishes an explicitly discarded session when successful navigation deactivates its cached page synchronously", async () => {
  let changeActivity!: (active: boolean) => void;
  const navigateAway = vi.fn(() => {
    flushSync(() => changeActivity(false));
  });
  function CachedApp() {
    const [active, setActive] = useState(true);
    changeActivity = setActive;
    return (
      <ExtensionActivityProvider active={active}>
        <ExtensionApp
          item={item}
          commandId="open"
          runs={[]}
          onClose={navigateAway}
          onSettled={onSettled}
        />
      </ExtensionActivityProvider>
    );
  }
  render(<CachedApp />);
  const input = await screen.findByLabelText("Query");
  fireEvent.change(input, { target: { value: "Discard after navigation" } });
  fireEvent.click(sessionButton("End session"));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard and end" }),
    );
  });
  expect(navigateAway).toHaveBeenCalledOnce();
  expect(lifecycle.work?.dirty).toBe(false);
  expect(input).not.toBeInTheDocument();
  await act(async () => changeActivity(true));
  expect(await screen.findByLabelText("Query")).toHaveValue("Original");
  expect(native.viewExtension).toHaveBeenCalledTimes(2);
});

it("keeps session tools out of the main workflow and preserves a draft when ending is cancelled", async () => {
  render(app());
  const input = await screen.findByLabelText("Query");
  expect(
    screen.queryByText("Export session", { selector: "button" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Stop", { selector: "button" }),
  ).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "Keep my progress" } });
  const end = sessionButton("End session");
  fireEvent.click(end);
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(input).toHaveValue("Keep my progress");
  expect(screen.getByRole("button", { name: "Extension tools" })).toHaveFocus();
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect(native.cancelExtension).not.toHaveBeenCalled();
});

it("dismisses cached session tools on navigation and does not reopen them or steal focus when returning", async () => {
  const content = (active: boolean) => (
    <>
      <button>Current page action</button>
      <ExtensionActivityProvider active={active}>
        <section hidden={!active}>{app()}</section>
      </ExtensionActivityProvider>
    </>
  );
  const mounted = render(content(true));
  await screen.findByLabelText("Query");
  openSessionTools();
  expect(screen.getByRole("menu", { name: "Extension tools" })).toBeVisible();

  mounted.rerender(content(false));
  const currentAction = screen.getByRole("button", {
    name: "Current page action",
  });
  currentAction.focus();
  await act(async () => {});
  expect(currentAction).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  mounted.rerender(content(true));
  await act(async () => {});
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(currentAction).toHaveFocus();
  openSessionTools();
  expect(screen.getByRole("menu", { name: "Extension tools" })).toBeVisible();

  // 鼠标 / 键盘导航也可能先把焦点交给下一页的操作，再停用旧页面。
  currentAction.focus();
  mounted.rerender(content(false));
  await act(async () => {});
  expect(currentAction).toHaveFocus();
  mounted.rerender(content(true));
  await act(async () => {});
  expect(currentAction).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("labels the compact menu after a hover delay without adding headings, forms or autofocus hints", async () => {
  render(app());
  await screen.findByLabelText("Query");
  const trigger = screen.getByRole("button", {
    name: "Extension tools",
  });
  expect(
    screen.getAllByRole("status", { name: "Execution status" }),
  ).toHaveLength(1);
  vi.useFakeTimers();
  fireEvent.pointerMove(trigger, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(50));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Extension tools");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("menu", { name: "Extension tools" })).toBeVisible();
  expect(
    screen
      .getByRole("menu")
      .querySelector("h2,h3,form,input,textarea,details,[data-extension-help]"),
  ).toBeNull();
  for (const action of screen.getAllByRole("menuitem"))
    expect(action.querySelector("svg")).not.toBeNull();
  expect(
    screen.getAllByRole("status", { name: "Execution status" }),
  ).toHaveLength(1);
  expect(screen.getByRole("status", { name: "Execution status" })).toHaveClass(
    "sr-only",
  );
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("status", { name: "Execution status" }),
  ).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(
    screen.queryByRole("menu", { name: "Extension tools" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

it("opens data in a separate focused dialog and keeps its draft after Escape returns to the tools trigger", async () => {
  render(
    <ExtensionApp
      item={{ ...item, grantedPermissions: ["text:read"] }}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await screen.findByLabelText("Query");
  fireEvent.click(sessionButton("Send data…"));
  const dialog = await screen.findByRole("dialog", { name: "Send data" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const text = within(dialog).getByRole("textbox", { name: "Input text" });
  await waitFor(() => expect(text).toHaveFocus());
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.change(text, { target: { value: "Retain this unsent draft" } });
  fireEvent.keyDown(text, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "Extension tools" })).toHaveFocus();
  expect(native.viewExtension).toHaveBeenCalledOnce();
  fireEvent.click(sessionButton("Send data…"));
  expect(await screen.findByLabelText("Input text")).toHaveValue(
    "Retain this unsent draft",
  );
  expect(lifecycle.work?.dirty).toBe(true);
});

it("keeps the data draft without reopening its dialog when a cached page resumes", async () => {
  const content = (active: boolean) => (
    <>
      <button>Current page action</button>
      <ExtensionActivityProvider active={active}>
        <section hidden={!active}>
          <ExtensionApp
            item={{ ...item, grantedPermissions: ["text:read"] }}
            commandId="open"
            runs={[]}
            onClose={onClose}
            onSettled={onSettled}
          />
        </section>
      </ExtensionActivityProvider>
    </>
  );
  const mounted = render(content(true));
  await screen.findByLabelText("Query");
  fireEvent.click(sessionButton("Send data…"));
  fireEvent.change(await screen.findByLabelText("Input text"), {
    target: { value: "Retain this draft across navigation" },
  });

  mounted.rerender(content(false));
  const currentAction = screen.getByRole("button", {
    name: "Current page action",
  });
  currentAction.focus();
  await act(async () => {});
  expect(currentAction).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  mounted.rerender(content(true));
  await act(async () => {});
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(currentAction).toHaveFocus();
  fireEvent.click(sessionButton("Send data…"));
  expect(await screen.findByLabelText("Input text")).toHaveValue(
    "Retain this draft across navigation",
  );
  expect(lifecycle.work?.dirty).toBe(true);
});

it("retains progress when session export is cancelled and only ends after a successful export", async () => {
  vi.mocked(native.saveExtensionSession)
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
    within(dialog).getByRole("button", { name: "Export and end" }),
  );
  await within(dialog).findByRole("alert");
  expect(input).toHaveValue("Export before ending");
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Export and end" }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(native.saveExtensionSession).toHaveBeenLastCalledWith(
    "third-party.form-session.json",
    expect.stringContaining("Export before ending"),
  );
  expect(lifecycle.work?.dirty).toBe(false);
});

it("cancels a pending export-and-end decision without clearing the session after the file picker returns", async () => {
  const exporting = deferred<string | null>();
  vi.mocked(native.saveExtensionSession).mockReturnValueOnce(exporting.promise);
  render(app());
  const input = await screen.findByLabelText("Query");
  fireEvent.change(input, { target: { value: "Keep after abort" } });
  fireEvent.click(sessionButton("End session"));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Export and end" }),
  );
  await waitFor(() =>
    expect(native.saveExtensionSession).toHaveBeenCalledOnce(),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await act(async () => exporting.resolve("saved.json"));
  expect(input).toHaveValue("Keep after abort");
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  const end = sessionButton("End session");
  expect(end).not.toHaveAttribute("aria-disabled", "true");
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
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Query")).toHaveValue("Typed");
  expect(screen.getByText("Complete")).toBeVisible();
  expect(lifecycle.work?.dirty).toBe(true);
});

it("announces a long action and offers its stop operation from the compact menu", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  render(app());
  const submit = await screen.findByRole("button", { name: "Submit" });
  const status = screen.getByRole("status", { name: "Execution status" });
  openSessionTools();
  expect(
    screen.queryByRole("menuitem", { name: "Stop" }),
  ).not.toBeInTheDocument();
  fireEvent.click(submit);
  expect(status).toBeEmptyDOMElement();
  const stop = await screen.findByRole("menuitem", { name: "Stop" });
  expect(status).toHaveTextContent("Working…");
  fireEvent.click(stop);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(status).toHaveTextContent("Waiting for the extension to stop…");
  await act(async () => pending.resolve(first));
  expect(screen.getByRole("status", { name: "Execution status" })).toBe(status);
  expect(status).toBeEmptyDOMElement();
  openSessionTools();
  expect(
    screen.queryByRole("menuitem", { name: "Stop" }),
  ).not.toBeInTheDocument();
});
it("does not flash a running announcement or stop menu item for a short action", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise);
  render(app());
  const submit = await screen.findByRole("button", { name: "Submit" });
  openSessionTools();
  const status = screen.getByRole("status", { name: "Execution status" });
  vi.useFakeTimers();
  fireEvent.click(submit);
  expect(submit).toHaveAttribute("aria-disabled", "true");
  expect(
    screen.queryByRole("menuitem", { name: "Stop" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
    pending.resolve(first);
  });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(
    screen.queryByRole("menuitem", { name: "Stop" }),
  ).not.toBeInTheDocument();
  expect(status).toBeEmptyDOMElement();
  expect(submit).toHaveAttribute("aria-disabled", "false");
});

it("refreshes the current view locale while retaining field drafts and unsaved state", async () => {
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce({
      ...first,
      display: "本地化视图",
      fields: [{ id: "query", label: "查询", value: "Canonical value" }],
    });
  const mounted = render(app());
  fireEvent.change(await screen.findByLabelText("Query"), {
    target: { value: "Unsubmitted draft" },
  });
  locale.language = "zh";
  mounted.rerender(app());
  expect(await screen.findByLabelText("查询")).toHaveValue("Unsubmitted draft");
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: undefined,
      request: expect.objectContaining({
        action: null,
        state: first.state,
        fields: { query: "Unsubmitted draft" },
        locale: "zh-CN",
      }),
    }),
  );
  expect(lifecycle.work?.dirty).toBe(true);
  await act(async () => lifecycle.work!.save());
  const saved = JSON.parse(
    vi.mocked(native.saveExtensionSession).mock.calls.at(-1)![1],
  );
  expect(saved.fields.query).toBe("Unsubmitted draft");
  expect(saved.view.fields[0].value).toBe("Canonical value");
});

it("uses declared defaults for newly added prototype-named fields during a locale refresh", async () => {
  const added = ["__proto__", "constructor", "toString"].map((id) => ({
    id,
    label: id,
    value: `Default for ${id}`,
  }));
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce({ ...first, fields: [...first.fields, ...added] });
  const mounted = render(app());
  fireEvent.change(await screen.findByLabelText("Query"), {
    target: { value: "Unsubmitted draft" },
  });
  locale.language = "zh";
  mounted.rerender(app());
  for (const field of added)
    expect(await screen.findByLabelText(field.label)).toHaveValue(field.value);
  expect(screen.getByLabelText("Query")).toHaveValue("Unsubmitted draft");
  await act(async () => lifecycle.work!.save());
  const saved = JSON.parse(
    vi.mocked(native.saveExtensionSession).mock.calls.at(-1)![1],
  );
  expect(saved.fields).toEqual(
    Object.fromEntries([
      ["query", "Unsubmitted draft"],
      ...added.map((field) => [field.id, field.value]),
    ]),
  );
});

it("refreshes the requested locale after a draft changed before the locale effect is corrected", async () => {
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce({
      ...first,
      fields: [{ id: "query", label: "查询", value: "Canonical value" }],
    });
  function DraftPatch({ draft }: { draft?: string }) {
    const { sessionCache } = useExtensions();
    useEffect(() => {
      if (draft !== undefined)
        sessionCache.sessions.get(`${item.package.manifest.id}:open`)!.update({
          fields: {
            query: draft,
          },
        });
    }, [draft, sessionCache]);
    return null;
  }
  function workspace(draft?: string) {
    return (
      <>
        <DraftPatch draft={draft} />
        {app()}
      </>
    );
  }
  const mounted = render(workspace());
  await screen.findByLabelText("Query");
  locale.language = "zh";
  mounted.rerender(workspace("x".repeat(2049)));
  expect(native.viewExtension).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Corrected draft" },
  });
  expect(await screen.findByLabelText("查询")).toHaveValue("Corrected draft");
  expect(native.viewExtension).toHaveBeenCalledTimes(2);
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        locale: "zh-CN",
        fields: { query: "Corrected draft" },
      }),
    }),
  );
});

it("waits for an action before rendering the latest locale and does not retry a failed refresh automatically", async () => {
  const pending = deferred<native.ExtensionView>();
  vi.mocked(native.viewExtension)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce({ code: "EXTENSION_RUN_FAILED" });
  const mounted = render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
  locale.language = "zh";
  mounted.rerender(app());
  expect(native.viewExtension).toHaveBeenCalledTimes(2);
  expect(native.cancelExtension).not.toHaveBeenCalled();
  await act(async () =>
    pending.resolve({ ...first, state: "Committed action" }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  mounted.rerender(app());
  expect(native.viewExtension).toHaveBeenCalledTimes(3);
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        action: null,
        state: "Committed action",
        locale: "zh-CN",
      }),
    }),
  );
  expect(screen.getByLabelText("Query")).toHaveValue("Original");
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
    ).toHaveTextContent("Queued…"),
  );
  openSessionTools();
  fireEvent.click(screen.getByRole("menuitem", { name: "Stop" }));
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
  expect(native.saveExtensionSession).toHaveBeenCalledWith(
    "third-party.form-session.json",
    expect.stringContaining("completed after detach"),
  );
  const controller = new AbortController();
  controller.abort();
  await expect(work.discard(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await work.save();
  expect(native.saveExtensionSession).toHaveBeenLastCalledWith(
    "third-party.form-session.json",
    expect.stringContaining("completed after detach"),
  );
});

it("restores the same view and edited fields when navigating away and back within a host window", async () => {
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : <p>Other page</p>}
      </>
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
  vi.mocked(native.saveExtensionSession).mockReturnValueOnce(exporting.promise);
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : <p>Other page</p>}
      </>
    );
  }
  render(<Workspace />);
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Export this draft" },
  });
  fireEvent.click(sessionButton("Export session"));
  await waitFor(() =>
    expect(native.saveExtensionSession).toHaveBeenCalledOnce(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByLabelText("Query")).toHaveValue("Export this draft");
  expect(screen.getByLabelText("Query")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(sessionButton("Export session")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(sessionButton("End session")).toHaveAttribute("aria-disabled", "true");
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

it("keeps select drafts in the generic form restricted to the current view options", async () => {
  vi.mocked(native.viewExtension).mockResolvedValue({
    ...first,
    fields: [
      {
        id: "query",
        label: "Category",
        kind: "select",
        value: "one",
        options: [{ label: "One", value: "one" }],
      },
    ],
  });
  function DraftPatch({ value }: { value?: string }) {
    const { sessionCache } = useExtensions();
    useEffect(() => {
      if (value !== undefined)
        sessionCache.sessions
          .get(`${item.package.manifest.id}:open`)!
          .update({ fields: { query: value } });
    }, [sessionCache, value]);
    return null;
  }
  const workspace = (value?: string) => (
    <>
      <DraftPatch value={value} />
      {app()}
    </>
  );
  const mounted = render(workspace());
  await screen.findByRole("combobox", { name: "Category" });
  mounted.rerender(workspace("missing"));
  const submit = screen.getByRole("button", { name: "Submit" });
  expect(submit).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(submit);
  expect(native.viewExtension).toHaveBeenCalledOnce();
  mounted.rerender(workspace("one"));
  expect(submit).toHaveAttribute("aria-disabled", "false");
  fireEvent.click(submit);
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
});

it("exports and restores an over-limit draft separately from its valid view until the user corrects it", async () => {
  vi.mocked(native.validateExtensionView).mockResolvedValueOnce(first);
  render(app());
  const input = await screen.findByLabelText("Query");
  const draft = "x".repeat(2049);
  fireEvent.change(input, { target: { value: draft } });
  expect(input).toBeInvalid();
  await act(async () => lifecycle.work!.save());
  const content = String(
    vi.mocked(native.saveExtensionSession).mock.calls.at(-1)?.[1],
  );
  const exported = JSON.parse(content) as {
    fields: Record<string, string>;
    view: native.ExtensionView;
  };
  expect(exported.fields).toEqual({ query: draft });
  expect(exported.view).toEqual(first);
  fireEvent.change(input, { target: { value: "Current edit" } });
  const file = new File([content], "session.json", {
    type: "application/json",
  });
  file.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
  fireEvent.change(screen.getByLabelText("Import session"), {
    target: { files: [file] },
  });
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace session" }),
  );
  expect(input).toHaveValue(draft);
  expect(input).toBeInvalid();
  expect(native.validateExtensionView).toHaveBeenCalledWith(
    JSON.stringify(first),
  );
  expect(native.viewExtension).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(native.viewExtension).toHaveBeenCalledOnce();
  await act(async () => lifecycle.work!.save());
  expect(native.saveExtensionSession).toHaveBeenLastCalledWith(
    "third-party.form-session.json",
    content,
  );
  fireEvent.change(input, { target: { value: "Corrected" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
});

it("keeps an over-hard-budget draft dirty and rejects saving before opening a native file dialog", async () => {
  render(app());
  const input = await screen.findByLabelText("Query");
  const draft = "x".repeat(256 * 1024 + 1);
  fireEvent.change(input, { target: { value: draft } });
  await act(async () => {
    await expect(lifecycle.work!.save()).rejects.toMatchObject({
      code: "INPUT_TOO_LONG",
    });
  });
  expect(native.saveExtensionSession).not.toHaveBeenCalled();
  expect(input).toHaveValue(draft);
  expect(lifecycle.work?.dirty).toBe(true);
});

it("preserves the draft and unlocks a remounted session when its export is cancelled", async () => {
  const exporting = deferred<string | null>();
  vi.mocked(native.saveExtensionSession).mockReturnValueOnce(exporting.promise);
  function Workspace() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : <p>Other page</p>}
      </>
    );
  }
  render(<Workspace />);
  await screen.findByLabelText("Query");
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "Keep this draft after cancellation" },
  });
  fireEvent.click(sessionButton("Export session"));
  await waitFor(() =>
    expect(native.saveExtensionSession).toHaveBeenCalledOnce(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  await act(async () => exporting.resolve(null));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Query")).toBeEnabled();
  expect(screen.getByLabelText("Query")).toHaveValue(
    "Keep this draft after cancellation",
  );
  expect(lifecycle.work?.dirty).toBe(true);
  fireEvent.click(sessionButton("Export session"));
  await waitFor(() =>
    expect(native.saveExtensionSession).toHaveBeenCalledTimes(2),
  );
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
  fireEvent.click(screen.getByRole("menuitem", { name: "Send data…" }));
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "Explicit input" },
  });
  fireEvent.change(screen.getByLabelText("URL (optional)"), {
    target: { value: "https://httpbin.org/get" },
  });
  expect(native.viewExtension).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Send data" }));
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
  fireEvent.click(screen.getByRole("menuitem", { name: "Send data…" }));
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "keep text" },
  });
  fireEvent.change(screen.getByLabelText("URL (optional)"), {
    target: { value: "https://service.example/data" },
  });
  mounted.rerender(view(["text:read"]));
  expect(screen.queryByLabelText("URL (optional)")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send data" }));
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
      <>
        <button onClick={() => setVersion("1.1.0")}>Upgrade</button>
        <ExtensionApp
          key={version}
          item={upgraded}
          commandId="open"
          runs={[]}
          onClose={onClose}
          onSettled={onSettled}
        />
      </>
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
      <>
        <button onClick={() => setGeneration(2)}>Replace installation</button>
        <ExtensionApp
          key={generation}
          item={{ ...item, generation }}
          commandId="open"
          runs={[]}
          onClose={onClose}
          onSettled={onSettled}
        />
      </>
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
      <>
        <button onClick={() => setVisible(!visible)}>Navigate</button>
        {visible ? app() : null}
      </>
    );
  }
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  openSessionTools();
  expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(
    screen.queryByRole("menuitem", { name: "Stop" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("menuitem", { name: "Stop" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    ),
  );
  expect(lifecycle.work?.dirty).toBe(true);
  await act(async () => pending.reject({ code: "EXTENSION_RUN_FAILED" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
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
  fireEvent.click(screen.getByRole("menuitem", { name: "Send data…" }));
  fireEvent.click(screen.getByRole("button", { name: "Files for this run" }));
  await screen.findByText("sample.txt");
  fireEvent.click(screen.getByRole("button", { name: "Files for this run" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Send data" }), {
    key: "Escape",
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(sessionButton("Export session")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(sessionButton("End session")).toHaveAttribute("aria-disabled", "true");
  const saving = lifecycle.work!.save();
  expect(native.saveExtensionSession).not.toHaveBeenCalled();
  await act(async () => {
    selecting.resolve([]);
    await saving;
  });
  fireEvent.click(sessionButton("Send data…"));
  expect(screen.getByText("sample.txt")).toBeVisible();
  expect(native.saveExtensionSession).toHaveBeenCalledWith(
    "third-party.form-session.json",
    expect.stringContaining('"sample.txt"'),
  );
  expect(lifecycle.work?.dirty).toBe(false);
});

it("requires confirmation before importing a version-bound session and never restores native file IDs", async () => {
  const validation = deferred<native.ExtensionView>();
  vi.mocked(native.validateExtensionView).mockReturnValueOnce(
    validation.promise,
  );
  const importedView = {
    ...first,
    state: "restored state",
  };
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
  const input = screen.getByLabelText("Import session");
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  fireEvent.click(sessionButton("Import session"));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(input).toBeInTheDocument();
  fireEvent.change(input, {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(native.validateExtensionView).toHaveBeenCalledOnce(),
  );
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => validation.resolve(importedView));
  const dialog = await screen.findByRole("dialog");
  expect(screen.getByLabelText("Query")).toHaveValue("Current unsaved input");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  expect(dialog).toHaveTextContent("reselect.txt");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace session" }),
  );
  expect(screen.getByLabelText("Query")).toHaveValue("Restored input");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  await act(async () => lifecycle.work!.save());
  const exported = JSON.parse(
    String(vi.mocked(native.saveExtensionSession).mock.calls.at(-1)?.[1]),
  ) as { files: string[]; fields: Record<string, string> };
  expect(exported.files).toEqual([]);
  expect(exported.fields).toEqual({ query: "Restored input" });
});

it("recreates the isolated document only after confirming a session import, retaining its checkpoint without executing Wasm", async () => {
  const uiHash = "b".repeat(64);
  const documentItem: native.ExtensionInfo = {
    ...item,
    package: {
      ...item.package,
      uiDocuments: [{ id: "main", sha256: uiHash, bytes: 100 }],
      manifest: {
        ...item.package.manifest,
        commands: item.package.manifest.commands.map((command) => ({
          ...command,
          ui: { sidebar: true, window: true, document: "main" },
        })),
      },
    },
  };
  vi.mocked(native.openExtensionUi)
    .mockResolvedValueOnce({ url: "extension-ui://surface/old", token: "old" })
    .mockResolvedValueOnce({ url: "extension-ui://surface/new", token: "new" });
  vi.mocked(native.validateExtensionView).mockResolvedValue({
    ...first,
    state: "Imported Wasm state",
    fields: [{ id: "query", label: "Query", value: "Imported field" }],
  });
  const mounted = render(
    <ExtensionApp
      item={documentItem}
      commandId="open"
      runs={[]}
      onClose={onClose}
      onSettled={onSettled}
    />,
  );
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(mounted.container.querySelector("iframe")).toHaveAttribute(
      "src",
      "extension-ui://surface/old",
    ),
  );
  const originalFrame = mounted.container.querySelector("iframe");
  const checkpoint = JSON.stringify({
    schema: 1,
    fields: { query: "Imported UI draft" },
  });
  const content = JSON.stringify({
    formatVersion: 1,
    kind: "view",
    extensionId: item.package.manifest.id,
    commandId: "open",
    extensionVersion: item.package.manifest.version,
    sha256: item.package.sha256,
    ui: { sha256: uiHash, state: checkpoint },
    view: first,
    fields: { query: "Imported field" },
    inputText: "",
    url: "",
    files: [],
    result: null,
  });
  const file = new File([content], "document-session.json", {
    type: "application/json",
  });
  file.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
  openSessionTools();
  fireEvent.change(screen.getByLabelText("Import session"), {
    target: { files: [file] },
  });
  const dialog = await screen.findByRole("dialog");
  expect(mounted.container.querySelector("iframe")).toBe(originalFrame);
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
  expect(native.closeExtensionUi).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace session" }),
  );
  await waitFor(() => expect(native.openExtensionUi).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(mounted.container.querySelector("iframe")).toHaveAttribute(
      "src",
      "extension-ui://surface/new",
    ),
  );
  expect(mounted.container.querySelector("iframe")).not.toBe(originalFrame);
  expect(originalFrame).not.toBeInTheDocument();
  expect(native.closeExtensionUi).toHaveBeenCalledWith("old");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  await act(async () => lifecycle.work!.save());
  const exported = JSON.parse(
    String(vi.mocked(native.saveExtensionSession).mock.calls.at(-1)?.[1]),
  ) as { ui: { state: string }; fields: Record<string, string> };
  expect(exported.ui.state).toBe(checkpoint);
  expect(exported.fields).toEqual({ query: "Imported field" });
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

it("waits for the artifact picker before lifecycle discard and preserves progress when discard is aborted", async () => {
  const exporting = deferred<string | null>();
  const artifact: native.ExtensionArtifact = {
    name: "draft.txt",
    mediaType: "text/plain",
    encoding: "utf8",
    content: "draft",
  };
  vi.mocked(native.viewExtension).mockResolvedValueOnce({
    ...first,
    artifacts: [artifact],
  });
  vi.mocked(native.saveExtensionArtifact).mockReturnValueOnce(
    exporting.promise,
  );
  render(app());
  fireEvent.change(await screen.findByLabelText("Query"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft.txt" }));
  const controller = new AbortController();
  let discarded = false;
  const pending = Promise.resolve(
    lifecycle.work!.discard(controller.signal),
  ).then(
    () => {
      discarded = true;
    },
    (reason: unknown) => reason,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(discarded).toBe(false);
  controller.abort();
  await act(async () => {
    exporting.resolve(null);
    await pending;
  });
  expect(screen.getByLabelText("Query")).toHaveValue("Keep this draft");
  expect(lifecycle.work?.dirty).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

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
import {
  MemoryRouter,
  Link,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import * as native from "@/lib/tauri";
import { ExtensionsProvider } from "@/features/extensions/extensions-provider";
import { AppShell } from "@/layouts/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UnsavedWorkProvider } from "@/providers/unsaved-work";
import ExtensionPage from "./extension-app";
import {
  ExtensionChromeProvider,
  ExtensionChromeSlot,
} from "@/features/extensions/extension-chrome-slot";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: () => true,
  extensionSnapshot: vi.fn(),
  prepareEnabledExtensions: vi.fn().mockResolvedValue(undefined),
  onExtensionsChanged: vi.fn(),
  viewExtension: vi.fn(),
  openExtensionWindow: vi.fn(),
  openExtensionCenter: vi.fn(),
  closeWindow: vi.fn(),
  saveExtensionSession: vi.fn(),
  setWindowWorkState: vi.fn(),
  onLifecycleRequest: vi.fn(),
  onLifecycleFinished: vi.fn(),
  onLifecycleExecuting: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({
    settings: {
      appMode: "minimal",
      sidebarWidth: 224,
      sidebarCollapsed: false,
      motion: false,
      theme: "light",
    },
  }),
}));
vi.mock("@/providers/commands", () => ({
  useCommands: () => ({ fullscreen: false, execute: vi.fn() }),
}));
vi.mock("@/components/title-bar", () => ({ TitleBar: () => null }));
vi.mock("@/components/window-background", () => ({
  WindowBackground: () => null,
}));

const item: native.ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: [],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      id: "example.lab",
      version: "1.0.0",
      name: "Lab app",
      description: "A real extension entry",
      author: "Example",
      permissions: [],
      commands: [
        {
          id: "open",
          title: "Open lab",
          function: "lab",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
          ui: { sidebar: true, window: true },
        },
      ],
      minHostVersion: "0.1.0",
      optionalPermissions: [],
      network: [],
    },
  },
};
let changed: () => void;
let snapshot: native.ExtensionSnapshot;
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = { revision: 1, items: [item], runs: [] };
  vi.mocked(native.extensionSnapshot).mockImplementation(async () => snapshot);
  vi.mocked(native.onExtensionsChanged).mockImplementation(async (handler) => {
    changed = handler;
    return () => {};
  });
  vi.mocked(native.viewExtension).mockResolvedValue({
    version: 2,
    state: "state",
    display: "Application content",
    description: "A regular page",
    fields: [{ id: "draft", label: "Draft", value: "initial" }],
    groups: [],
  });
  vi.mocked(native.openExtensionWindow).mockResolvedValue(undefined);
  vi.mocked(native.closeWindow).mockResolvedValue(undefined);
  vi.mocked(native.saveExtensionSession).mockResolvedValue("session.json");
  vi.mocked(native.setWindowWorkState).mockResolvedValue(undefined);
  vi.mocked(native.onLifecycleRequest).mockResolvedValue(vi.fn());
  vi.mocked(native.onLifecycleFinished).mockResolvedValue(vi.fn());
  vi.mocked(native.onLifecycleExecuting).mockResolvedValue(vi.fn());
});
afterEach(cleanup);
function StandaloneLayout() {
  const { pathname } = useLocation();
  return (
    <ExtensionChromeProvider scope={pathname}>
      <ExtensionChromeSlot placement="titlebar" />
      <Outlet />
    </ExtensionChromeProvider>
  );
}
function workspace(standalone = false) {
  return render(
    <TooltipProvider>
      <UnsavedWorkProvider>
        <ExtensionsProvider>
          <MemoryRouter initialEntries={["/extensions/app/example.lab/open"]}>
            <Routes>
              <Route element={standalone ? <StandaloneLayout /> : <AppShell />}>
                <Route
                  path="/extensions/app/:extensionId/:commandId"
                  element={<ExtensionPage standalone={standalone} />}
                />
                <Route path="/settings" element={<h2>Other page</h2>} />
                <Route
                  path="/extensions"
                  element={
                    <Link to="/extensions/app/example.lab/open">
                      Return to lab
                    </Link>
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        </ExtensionsProvider>
      </UnsavedWorkProvider>
    </TooltipProvider>,
  );
}
it("contributes a usable sidebar page in minimal mode, preserves edits across navigation, and requests a native window", async () => {
  workspace();
  await screen.findByText("Application content");
  const link = screen.getByRole("link", { name: "Lab app" });
  expect(link).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const draft = await screen.findByLabelText("Draft");
  fireEvent.change(draft, {
    target: { value: "Keep this edit" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Other page" });
  expect(draft).toBeInTheDocument();
  expect(draft).not.toBeVisible();
  expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Lab app"]);
  fireEvent.click(link);
  expect(await screen.findByLabelText("Draft")).toHaveValue("Keep this edit");
  expect(screen.getByLabelText("Draft")).toBe(draft);
  expect(native.viewExtension).toHaveBeenCalledOnce();
  expect(document.querySelector(".app-route-context")).toBeNull();
  expect(document.querySelector("[data-extension-surface] header")).toBeNull();
  expect(
    screen.queryByRole("menuitem", { name: "Open in separate window" }),
  ).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "Extension tools" });
  expect(trigger.closest("a")).toBeNull();
  expect(trigger.closest("[data-sidebar-extension]")).toBe(link.parentElement);
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(link).toHaveAttribute("aria-current", "page");
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Open in separate window" }),
  );
  await waitFor(() =>
    expect(native.openExtensionWindow).toHaveBeenCalledWith(
      "example.lab",
      "open",
      item.package.sha256,
      item.generation,
    ),
  );
});

it("keeps session tools available in standalone mode without a redundant return or separate-window action", async () => {
  workspace(true);
  fireEvent.change(await screen.findByLabelText("Draft"), {
    target: { value: "Standalone draft" },
  });
  fireEvent.keyDown(screen.getByRole("button", { name: "Extension tools" }), {
    key: "ArrowDown",
  });
  expect(
    screen.getByRole("menuitem", { name: "Export session" }),
  ).toBeEnabled();
  expect(screen.getByLabelText("Import session JSON")).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: "End session" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Extensions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Extensions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Open in separate window" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Export session" }));
  await waitFor(() =>
    expect(native.saveExtensionSession).toHaveBeenCalledWith(
      "example.lab-session.json",
      expect.stringContaining("Standalone draft"),
    ),
  );
  expect(native.openExtensionCenter).not.toHaveBeenCalled();
  expect(native.closeWindow).not.toHaveBeenCalled();
});

it("starts a fresh view session when the installation changes without changing the module hash or version", async () => {
  workspace();
  const draft = await screen.findByLabelText("Draft");
  fireEvent.change(draft, { target: { value: "Old source draft" } });
  snapshot = { ...snapshot, revision: 2, items: [{ ...item, generation: 2 }] };
  await act(async () => changed());
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Draft")).toHaveValue("initial");
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedSha256: item.package.sha256,
      expectedGeneration: 2,
      request: expect.objectContaining({ state: "", fields: {} }),
    }),
  );
});

it("closes an unavailable standalone entry without navigating into the host application", async () => {
  snapshot = { revision: 2, items: [], runs: [] };
  workspace(true);
  await screen.findByText(/This extension is disabled/);
  expect(
    screen.queryByRole("link", { name: "Extensions" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(native.closeWindow).toHaveBeenCalledOnce());
  expect(native.viewExtension).not.toHaveBeenCalled();
});
it("revocation removes the sidebar contribution and stops exposing the application controls", async () => {
  workspace();
  await screen.findByLabelText("Draft");
  snapshot = {
    revision: 2,
    items: [{ ...item, enabled: false }],
    runs: [],
  };
  await act(async () => changed());
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Lab app" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByLabelText("Draft")).not.toBeInTheDocument();
  expect(screen.getByText(/This extension is disabled/)).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "Open in separate window" }),
  ).not.toBeInTheDocument();
});

it("keeps an edited session mounted and exportable when a snapshot refresh fails", async () => {
  workspace();
  const draft = await screen.findByLabelText("Draft");
  fireEvent.change(draft, {
    target: { value: "Keep through snapshot failure" },
  });
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Lab app"]),
  );
  vi.mocked(native.extensionSnapshot).mockRejectedValueOnce({
    code: "IO_ERROR",
    message: "Snapshot temporarily unavailable",
    retryable: true,
  });
  await act(async () => changed());
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Draft")).toBe(draft);
  expect(draft).toHaveValue("Keep through snapshot failure");
  expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Lab app"]);
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  fireEvent.keyDown(screen.getByRole("button", { name: "Extension tools" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Export session" }));
  await waitFor(() =>
    expect(native.saveExtensionSession).toHaveBeenCalledWith(
      "example.lab-session.json",
      expect.stringContaining("Keep through snapshot failure"),
    ),
  );
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith([]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Draft")).toBe(draft);
  expect(native.viewExtension).toHaveBeenCalledOnce();
});

it("retains the draft after standalone close fails and retries only after another explicit decision", async () => {
  vi.mocked(native.closeWindow).mockRejectedValueOnce(
    new Error("Close failed"),
  );
  workspace(true);
  const draft = await screen.findByLabelText("Draft");
  const sessionElement = draft.closest("section");
  fireEvent.change(draft, { target: { value: "Keep after close failure" } });
  fireEvent.keyDown(screen.getByRole("button", { name: "Extension tools" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "End session" }));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Discard and end" }),
  );
  await within(dialog).findByRole("alert");
  expect(native.closeWindow).toHaveBeenCalledOnce();
  expect(draft).toHaveValue("Keep after close failure");
  expect(draft.closest("section")).not.toHaveAttribute("hidden");
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Lab app"]),
  );
  snapshot = { ...snapshot, revision: 2 };
  await act(async () => changed());
  expect(native.closeWindow).toHaveBeenCalledOnce();
  expect(draft).toHaveValue("Keep after close failure");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Discard and end" }),
  );
  await waitFor(() => expect(native.closeWindow).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(sessionElement).toHaveAttribute("hidden"));
  expect(native.viewExtension).toHaveBeenCalledOnce();
});

it("keeps the draft when an in-flight standalone close decision is aborted", async () => {
  let finishClose!: () => void;
  vi.mocked(native.closeWindow).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishClose = resolve;
    }),
  );
  workspace(true);
  const draft = await screen.findByLabelText("Draft");
  fireEvent.change(draft, { target: { value: "Keep after aborted close" } });
  fireEvent.keyDown(screen.getByRole("button", { name: "Extension tools" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "End session" }));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Discard and end" }),
  );
  await waitFor(() => expect(native.closeWindow).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith([]),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await act(async () => finishClose());
  expect(draft).toHaveValue("Keep after aborted close");
  expect(draft.closest("section")).not.toHaveAttribute("hidden");
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Lab app"]),
  );
  expect(native.closeWindow).toHaveBeenCalledOnce();
});

it("clears the confirmed embedded session before navigation unmounts its unsaved-work registration", async () => {
  workspace();
  fireEvent.change(await screen.findByLabelText("Draft"), {
    target: { value: "Discard this embedded session" },
  });
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith(["Lab app"]),
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Extension tools" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "End session" }));
  const dialog = await screen.findByRole("dialog", {
    name: "End this session?",
  });
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard and end" }),
    );
  });
  const back = await screen.findByRole("link", { name: "Return to lab" });
  await waitFor(() =>
    expect(native.setWindowWorkState).toHaveBeenLastCalledWith([]),
  );
  fireEvent.click(back);
  expect(await screen.findByLabelText("Draft")).toHaveValue("initial");
  expect(native.viewExtension).toHaveBeenCalledTimes(2);
  expect(native.closeWindow).not.toHaveBeenCalled();
});

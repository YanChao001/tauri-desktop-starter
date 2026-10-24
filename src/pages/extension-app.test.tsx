import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as native from "@/lib/tauri";
import { ExtensionsProvider } from "@/features/extensions/extensions-provider";
import { AppShell } from "@/layouts/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UnsavedWorkProvider } from "@/providers/unsaved-work";
import ExtensionPage from "./extension-app";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: () => true,
  extensionSnapshot: vi.fn(),
  onExtensionsChanged: vi.fn(),
  viewExtension: vi.fn(),
  openExtensionWindow: vi.fn(),
  closeWindow: vi.fn(),
  saveTextExport: vi.fn(),
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
  enabled: true,
  grantedPermissions: [],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    manifest: {
      formatVersion: 2,
      apiVersion: 1,
      id: "example.lab",
      version: "1.0.0",
      name: "Lab app",
      description: "A real extension entry",
      author: "Example",
      inputFormat: "json",
      resultFormat: "view",
      ui: { sidebar: true, window: true },
      permissions: [],
      commands: [{ id: "open", title: "Open lab", function: "lab" }],
    },
  },
};
let changed: () => void;
let snapshot: native.ExtensionSnapshot;
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = { revision: 1, items: [item], runningId: null };
  vi.mocked(native.extensionSnapshot).mockImplementation(async () => snapshot);
  vi.mocked(native.onExtensionsChanged).mockImplementation(async (handler) => {
    changed = handler;
    return () => {};
  });
  vi.mocked(native.viewExtension).mockResolvedValue({
    version: 1,
    state: "state",
    display: "Application content",
    description: "A regular page",
    fields: [{ id: "draft", label: "Draft", value: "initial" }],
    groups: [],
  });
  vi.mocked(native.openExtensionWindow).mockResolvedValue(undefined);
  vi.mocked(native.closeWindow).mockResolvedValue(undefined);
  vi.mocked(native.saveTextExport).mockResolvedValue("session.json");
  vi.mocked(native.setWindowWorkState).mockResolvedValue(undefined);
  vi.mocked(native.onLifecycleRequest).mockResolvedValue(vi.fn());
  vi.mocked(native.onLifecycleFinished).mockResolvedValue(vi.fn());
  vi.mocked(native.onLifecycleExecuting).mockResolvedValue(vi.fn());
});
afterEach(cleanup);
function workspace(standalone = false) {
  return render(
    <TooltipProvider>
      <UnsavedWorkProvider>
        <ExtensionsProvider>
          <MemoryRouter initialEntries={["/extensions/app/example.lab/open"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route
                  path="/extensions/app/:extensionId/:commandId"
                  element={<ExtensionPage standalone={standalone} />}
                />
                <Route path="/settings" element={<h2>Other page</h2>} />
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
  fireEvent.change(screen.getByLabelText("Draft"), {
    target: { value: "Keep this edit" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Other page" });
  fireEvent.click(link);
  expect(await screen.findByLabelText("Draft")).toHaveValue("Keep this edit");
  expect(native.viewExtension).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: "Open in separate window" }),
  );
  await waitFor(() =>
    expect(native.openExtensionWindow).toHaveBeenCalledWith(
      "example.lab",
      "open",
      item.package.sha256,
    ),
  );
});

it("closes an unavailable standalone entry without navigating into the host application", async () => {
  snapshot = { revision: 2, items: [], runningId: null };
  workspace(true);
  await screen.findByText(/This extension is disabled/);
  expect(
    screen.queryByRole("link", { name: "Extension center" }),
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
    runningId: null,
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
    screen.queryByRole("button", { name: "Open in separate window" }),
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
  fireEvent.click(screen.getByRole("button", { name: "Export session" }));
  await waitFor(() =>
    expect(native.saveTextExport).toHaveBeenCalledWith(
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

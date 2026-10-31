import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import Extensions from "./extensions";

const ui = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("@/components/native-page", () => ({
  NativePage: ({ children }: { children: ReactNode }) => <>{children}</>,
  ResourceError: () => null,
}));
vi.mock("@/features/extensions/extensions-provider", () => ({
  useExtensions: () => ({
    data: { revision: 4, items: [], runs: [] },
    loading: false,
    error: null,
    reload: ui.reload,
  }),
}));
vi.mock("@/features/extensions/use-extension-market", () => ({
  useExtensionMarket: () => ({
    data: null,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ t, language: "en" }) };
});
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: () => true,
  bundledExtensionCatalog: vi
    .fn()
    .mockResolvedValue({ hostVersion: "0.1.8", entries: [] }),
  previewExtension: vi.fn(),
  installExtension: vi.fn(),
}));

const preview: native.ExtensionPreview = {
  manifest: {
    formatVersion: 3,
    apiVersion: 2,
    id: "test.file-picker",
    version: "1.0.0",
    name: "File picker test",
    author: "Local",
    description: "A local extension package",
    commands: [
      {
        id: "run",
        title: "Run",
        function: "run",
        inputFormat: "text",
        resultFormat: "text",
        permissions: [],
      },
    ],
    permissions: ["text:read"],
    minHostVersion: "0.1.0",
    optionalPermissions: [],
    network: [],
  },
  sha256: "b".repeat(64),
  bytes: 100,
};

function open(tab: "installed" | "discover" = "discover") {
  render(
    <MemoryRouter
      initialEntries={[tab === "discover" ? "/?tab=discover" : "/"]}
    >
      <Extensions />
    </MemoryRouter>,
  );
  return screen.getByLabelText<HTMLInputElement>("Choose package");
}

function packageFile(name: string, content: string) {
  const file = new File([content], name, { type: "application/json" });
  file.arrayBuffer = async () => new TextEncoder().encode(content).buffer;
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.previewExtension).mockResolvedValue(preview);
  vi.mocked(native.installExtension).mockResolvedValue({
    revision: 5,
    items: [],
    runs: [],
  });
  ui.reload.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("shows the local installation tools only in the discovery tab", async () => {
  const user = userEvent.setup();
  open("installed");
  expect(
    screen.queryByRole("region", { name: "Plugin market" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Install from file" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Restore bundled workbench" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Developer docs" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Discover plugins" }));
  const tools = screen.getByRole("region", {
    name: "Plugin market",
  });
  expect(tools).toBeVisible();
  expect(
    within(tools).getByRole("button", { name: "Install from file" }),
  ).toBeEnabled();
  expect(
    within(tools).queryByRole("button", { name: "Restore bundled workbench" }),
  ).not.toBeInTheDocument();
  expect(
    within(tools).getByRole("link", { name: "Developer docs" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Local installation" }),
  ).not.toBeInTheDocument();
  expect(
    within(tools).getByRole("searchbox", { name: "Search plugins" }),
  ).toBeEnabled();
  expect(
    within(tools).getByRole("combobox", { name: "Category" }),
  ).toBeEnabled();

  await user.click(screen.getByRole("tab", { name: "Installed" }));
  expect(tools).not.toBeVisible();
  expect(native.previewExtension).not.toHaveBeenCalled();
  expect(native.installExtension).not.toHaveBeenCalled();
});

it("opens the hidden file input from a keyboard-operable custom trigger", async () => {
  const user = userEvent.setup();
  const input = open();
  expect(input).not.toBeVisible();
  expect(input).toHaveAttribute("accept", ".json,application/json");
  expect(screen.getByText("Install from file")).toBeVisible();
  const trigger = screen.getByRole("button", { name: "Install from file" });
  const pick = vi.spyOn(input, "click");
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(pick).toHaveBeenCalledOnce();
  expect(native.previewExtension).not.toHaveBeenCalled();
});

it("keeps the installation label through file selection, cancellation and installation while allowing another file", async () => {
  const user = userEvent.setup();
  const input = open();
  const name = `${"a-long-local-extension-name-".repeat(5)}.starter-extension.json`;
  let resolve!: (value: native.ExtensionPreview) => void;
  vi.mocked(native.previewExtension).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.change(input, {
    target: { files: [packageFile(name, "first package")] },
  });
  const trigger = screen.getByRole("button", {
    name: "Install from file",
  });
  expect(trigger).toHaveTextContent(/^Install from file$/);
  expect(trigger).toBeDisabled();
  expect(input.value).toBe("");
  await waitFor(() =>
    expect(native.previewExtension).toHaveBeenCalledExactlyOnceWith(
      "first package",
    ),
  );
  expect(native.installExtension).not.toHaveBeenCalled();
  await act(async () => resolve(preview));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Use .starter-extension.json",
  );
  fireEvent.change(input, { target: { files: [] } });
  expect(trigger).toHaveTextContent(/^Install from file$/);
  expect(native.previewExtension).toHaveBeenCalledOnce();

  await user.click(trigger);
  fireEvent.change(input, {
    target: { files: [packageFile("replacement.json", "replacement package")] },
  });
  const review = await screen.findByRole("dialog");
  expect(native.installExtension).not.toHaveBeenCalled();
  await user.click(within(review).getByRole("button", { name: "Install" }));
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledExactlyOnceWith(
      "replacement package",
      4,
      false,
      preview.sha256,
      { trusted: true, grantedPermissions: ["text:read"] },
    ),
  );
  expect(
    screen.getByRole("button", {
      name: "Install from file",
    }),
  ).toHaveTextContent(/^Install from file$/);
  expect(trigger).toBeEnabled();
  const pick = vi.spyOn(input, "click");
  await user.click(trigger);
  expect(pick).toHaveBeenCalledOnce();
  expect(ui.reload).toHaveBeenCalledOnce();
});

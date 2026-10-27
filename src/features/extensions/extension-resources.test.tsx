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
import { toast } from "sonner";
import * as native from "@/lib/tauri";
import { ExtensionResources } from "./extension-resources";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  extensionStorageInfo: vi.fn(),
  clearExtensionStorage: vi.fn(),
  extensionCredentialSlots: vi.fn(),
  setExtensionCredential: vi.fn(),
  deleteExtensionCredential: vi.fn(),
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
  grantedPermissions: ["storage", "network:https"],
  package: {
    bytes: 100,
    sha256: "a".repeat(64),
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "example.resources",
      version: "1.0.0",
      name: "Resources",
      author: "Example",
      description: "Example",
      commands: [],
      permissions: [],
      optionalPermissions: ["storage", "network:https"],
      network: [
        { origin: "https://service.example", methods: ["GET", "POST"] },
      ],
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.extensionStorageInfo).mockResolvedValue({
    revision: 4,
    entries: 2,
    bytes: 100,
  });
  vi.mocked(native.extensionCredentialSlots).mockResolvedValue([]);
  vi.mocked(native.setExtensionCredential).mockResolvedValue(undefined);
  vi.mocked(native.deleteExtensionCredential).mockResolvedValue(undefined);
  vi.mocked(native.clearExtensionStorage).mockResolvedValue(undefined);
});
afterEach(cleanup);
it("saves an origin-scoped credential, clears the secret input and deletes only the selected alias", async () => {
  render(<ExtensionResources item={item} />);
  await screen.findByText("2 entries · 100 bytes");
  fireEvent.change(screen.getByLabelText("Credential alias"), {
    target: { value: "api" },
  });
  const secret = screen.getByLabelText("Secret / access token");
  fireEvent.change(secret, { target: { value: "test-token" } });
  vi.mocked(native.extensionCredentialSlots).mockResolvedValue([
    { origin: "https://service.example", alias: "api" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
  await waitFor(() =>
    expect(native.setExtensionCredential).toHaveBeenCalledWith(
      "example.resources",
      item.package.sha256,
      item.generation,
      "https://service.example",
      "api",
      "test-token",
    ),
  );
  await waitFor(() => expect(secret).toHaveValue(""));
  expect(screen.queryByText("test-token")).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete credential api" }),
  );
  const confirmation = await screen.findByRole("dialog", {
    name: "Delete credential",
  });
  expect(confirmation).toHaveAccessibleDescription(
    expect.stringContaining("https://service.example"),
  );
  expect(native.deleteExtensionCredential).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(native.deleteExtensionCredential).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Delete credential api" }),
  );
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Delete credential",
    }),
  );
  await waitFor(() =>
    expect(native.deleteExtensionCredential).toHaveBeenCalledWith(
      "example.resources",
      item.package.sha256,
      item.generation,
      "https://service.example",
      "api",
    ),
  );
});

it("keeps failed credential deletion open for retry and focuses the origin when the slot disappears", async () => {
  vi.mocked(native.extensionCredentialSlots).mockResolvedValue([
    { origin: "https://service.example", alias: "api" },
  ]);
  vi.mocked(native.deleteExtensionCredential).mockRejectedValueOnce({
    code: "KEYRING_ERROR",
  });
  render(<ExtensionResources item={item} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete credential api" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Delete credential",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete credential" }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(within(dialog).getByRole("alert")).toBeVisible();
  expect(dialog).toBeVisible();
  vi.mocked(native.extensionCredentialSlots).mockResolvedValue([]);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete credential" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Service origin")).toHaveFocus(),
  );
  expect(native.deleteExtensionCredential).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole("button", { name: "Delete credential api" }),
  ).not.toBeInTheDocument();
});
it("requires confirmation and the displayed storage revision to clear private data", async () => {
  render(<ExtensionResources item={item} />);
  await screen.findByText("2 entries · 100 bytes");
  const clear = screen.getByRole("button", { name: "Clear private storage" });
  fireEvent.click(clear);
  const dialog = await screen.findByRole("dialog");
  expect(native.clearExtensionStorage).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(clear).toHaveFocus());
  fireEvent.click(clear);
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Clear private storage",
    }),
  );
  await waitFor(() =>
    expect(native.clearExtensionStorage).toHaveBeenCalledWith(
      "example.resources",
      item.package.sha256,
      item.generation,
      4,
    ),
  );
});
it("retains entered credentials after a failed save and keeps storage visible when credential listing fails", async () => {
  vi.mocked(native.extensionCredentialSlots).mockRejectedValue({
    code: "KEYRING_ERROR",
  });
  render(<ExtensionResources item={item} />);
  await screen.findByText("2 entries · 100 bytes");
  fireEvent.change(screen.getByLabelText("Credential alias"), {
    target: { value: "api" },
  });
  fireEvent.change(screen.getByLabelText("Secret / access token"), {
    target: { value: "keep-token" },
  });
  vi.mocked(native.setExtensionCredential).mockRejectedValueOnce({
    code: "KEYRING_ERROR",
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
  await waitFor(() =>
    expect(native.setExtensionCredential).toHaveBeenCalledOnce(),
  );
  expect(screen.getByLabelText("Secret / access token")).toHaveValue(
    "keep-token",
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
});

it("settles an initial storage failure and keeps refresh available without reporting endless loading", async () => {
  vi.mocked(native.extensionStorageInfo).mockRejectedValueOnce({
    code: "STORAGE_CORRUPT",
    message: "Private storage uses a newer schema version.",
  });
  render(<ExtensionResources item={item} />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  const storageStatus = screen.getByRole("status", {
    name: "Plugin private storage",
  });
  expect(within(storageStatus).getByRole("alert")).toHaveTextContent(
    "Private storage uses a newer schema version.",
  );
  const details = within(storageStatus).getByRole("button", {
    name: "View details",
  });
  fireEvent.click(details);
  const errorDetails = await screen.findByRole("dialog", {
    name: "View details",
  });
  expect(errorDetails).toHaveFocus();
  expect(errorDetails).toHaveTextContent(
    "Private storage uses a newer schema version.",
  );
  fireEvent.keyDown(errorDetails, { key: "Escape" });
  await waitFor(() => expect(details).toHaveFocus());
  expect(screen.queryByText("No result yet")).not.toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  const refresh = screen.getByRole("button", { name: "Refresh" });
  expect(refresh).toBeEnabled();
  fireEvent.click(refresh);
  const usage = await screen.findByText("2 entries · 100 bytes");
  expect(within(storageStatus).queryByRole("alert")).not.toBeInTheDocument();
  expect(usage).toHaveAttribute("tabindex", "0");
  fireEvent.focus(usage);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "2 entries · 100 bytes",
  );
  expect(native.extensionStorageInfo).toHaveBeenCalledTimes(2);
});

it("offers a refresh when credentials are the only resource and displays full long slot names on keyboard focus", async () => {
  const alias = "a".repeat(64);
  const origin = `https://${"long-service-host-".repeat(5)}example.com`;
  const networkOnly: native.ExtensionInfo = {
    ...item,
    package: {
      ...item.package,
      manifest: {
        ...item.package.manifest,
        optionalPermissions: ["network:https"],
      },
    },
  };
  vi.mocked(native.extensionCredentialSlots)
    .mockRejectedValueOnce({
      code: "KEYRING_ERROR",
      message: "Credential store is locked.",
    })
    .mockResolvedValueOnce([{ alias, origin }]);
  render(<ExtensionResources item={networkOnly} />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  const credentialsStatus = screen.getByRole("status", {
    name: "Service credentials",
  });
  expect(within(credentialsStatus).getByRole("alert")).toHaveTextContent(
    "Credential store is locked.",
  );
  const refresh = screen.getByRole("button", { name: "Refresh" });
  expect(refresh).toBeEnabled();
  fireEvent.click(refresh);
  const help = await screen.findByRole("button", { name: `${alias} · Help` });
  expect(
    within(credentialsStatus).queryByRole("alert"),
  ).not.toBeInTheDocument();
  fireEvent.focus(help);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    `${alias} · ${origin}`,
  );
});

it("keeps a failed clear confirmation open for retry and reports the error as a toast", async () => {
  vi.mocked(native.clearExtensionStorage).mockRejectedValueOnce({
    code: "CONFLICT",
  });
  render(<ExtensionResources item={item} />);
  await screen.findByText("2 entries · 100 bytes");
  fireEvent.click(
    screen.getByRole("button", { name: "Clear private storage" }),
  );
  const dialog = await screen.findByRole("dialog");
  const clear = within(dialog).getByRole("button", {
    name: "Clear private storage",
  });
  fireEvent.click(clear);
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(dialog).toBeVisible();
  expect(clear).toBeEnabled();
  expect(dialog).toHaveAccessibleDescription(
    expect.stringContaining("Current sessions and selected files are retained"),
  );
});

it("does not restart resource loading after a save completes on a disposed screen", async () => {
  let finish!: () => void;
  vi.mocked(native.setExtensionCredential).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const mounted = render(<ExtensionResources item={item} />);
  await screen.findByText("2 entries · 100 bytes");
  fireEvent.change(screen.getByLabelText("Credential alias"), {
    target: { value: "api" },
  });
  fireEvent.change(screen.getByLabelText("Secret / access token"), {
    target: { value: "secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
  mounted.unmount();
  await act(async () => finish());
  expect(native.extensionStorageInfo).toHaveBeenCalledOnce();
  expect(native.extensionCredentialSlots).toHaveBeenCalledOnce();
  expect(toast.error).not.toHaveBeenCalled();
});

it("keeps ordinary save failures separate from persistent resource read status", async () => {
  render(<ExtensionResources item={item} />);
  await screen.findByText("2 entries · 100 bytes");
  vi.mocked(native.setExtensionCredential).mockRejectedValueOnce({
    code: "KEYRING_ERROR",
  });
  fireEvent.change(screen.getByLabelText("Credential alias"), {
    target: { value: "api" },
  });
  fireEvent.change(screen.getByLabelText("Secret / access token"), {
    target: { value: "keep-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(
    within(
      screen.getByRole("status", { name: "Plugin private storage" }),
    ).queryByRole("alert"),
  ).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole("status", { name: "Service credentials" }),
    ).queryByRole("alert"),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Secret / access token")).toHaveValue(
    "keep-secret",
  );
});

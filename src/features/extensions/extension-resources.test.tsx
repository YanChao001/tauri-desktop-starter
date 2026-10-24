import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { ExtensionResources } from "./extension-resources";

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
  await waitFor(() =>
    expect(native.deleteExtensionCredential).toHaveBeenCalledWith(
      "example.resources",
      item.package.sha256,
      "https://service.example",
      "api",
    ),
  );
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
});

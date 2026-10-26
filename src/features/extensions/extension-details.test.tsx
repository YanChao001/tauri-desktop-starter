import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import type { ExtensionPermission, ExtensionPreview } from "@/lib/tauri";
import { ExtensionDetails } from "./extension-details";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(cleanup);

const value: ExtensionPreview = {
  sha256: "a".repeat(64),
  bytes: 100,
  manifest: {
    formatVersion: 3,
    apiVersion: 2,
    minHostVersion: "0.1.0",
    id: "test.permissions",
    name: "Permission review",
    description: "Review the requested capabilities",
    author: "Test",
    version: "1.0.0",
    permissions: ["text:read"],
    optionalPermissions: ["storage", "files:read", "wallpapers:manage"],
    network: [],
    commands: [],
  },
};

function renderConsent({
  preview = value,
  initial = ["text:read"],
  disabled = false,
}: {
  preview?: ExtensionPreview;
  initial?: ExtensionPermission[];
  disabled?: boolean;
} = {}) {
  const changed = vi.fn();
  function Consent() {
    const [grants, setGrants] = useState(initial);
    return (
      <ExtensionDetails
        value={preview}
        consent={{
          grants,
          disabled,
          onChange: (next) => {
            changed(next);
            setGrants(next);
          },
        }}
      />
    );
  }
  render(<Consent />);
  return changed;
}

it("keeps optional grants explicit and supports selecting, partially selecting and clearing the whole group", async () => {
  const user = userEvent.setup();
  const changed = renderConsent();
  const group = screen.getByRole("group", { name: "Optional capabilities" });
  const all = within(group).getByRole("checkbox", {
    name: "Select all optional capabilities",
  });
  const storage = within(group).getByRole("checkbox", {
    name: en["ext.permission.storage"],
  });
  expect(changed).not.toHaveBeenCalled();
  for (const checkbox of within(group).getAllByRole("checkbox"))
    expect(checkbox).not.toBeChecked();
  expect(
    within(group).queryByRole("checkbox", {
      name: en["ext.permission.text:read"],
    }),
  ).not.toBeInTheDocument();

  await user.tab();
  expect(all).toHaveFocus();
  await user.keyboard(" ");
  for (const checkbox of within(group).getAllByRole("checkbox"))
    expect(checkbox).toBeChecked();
  expect(changed).toHaveBeenLastCalledWith([
    "text:read",
    "storage",
    "files:read",
    "wallpapers:manage",
  ]);

  await user.click(storage);
  expect(all).toBePartiallyChecked();
  expect(changed).toHaveBeenLastCalledWith([
    "text:read",
    "files:read",
    "wallpapers:manage",
  ]);
  await user.click(all);
  expect(all).toBeChecked();
  expect(storage).toBeChecked();
  await user.click(all);
  for (const checkbox of within(group).getAllByRole("checkbox"))
    expect(checkbox).not.toBeChecked();
  expect(changed).toHaveBeenLastCalledWith(["text:read"]);
});

it("also offers select all for one optional capability without granting it by default", async () => {
  const user = userEvent.setup();
  const changed = renderConsent({
    preview: {
      ...value,
      manifest: { ...value.manifest, optionalPermissions: ["storage"] },
    },
    initial: [],
  });
  const all = screen.getByRole("checkbox", {
    name: "Select all optional capabilities",
  });
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(all).not.toBeChecked();
  expect(changed).not.toHaveBeenCalled();
  await user.click(all);
  expect(changed).toHaveBeenLastCalledWith(["storage"]);
});

it("reflects existing partial grants and disables the group while an operation is pending", async () => {
  const changed = renderConsent({
    initial: ["text:read", "storage"],
    disabled: true,
  });
  const all = screen.getByRole("checkbox", {
    name: "Select all optional capabilities",
  });
  expect(all).toBePartiallyChecked();
  for (const checkbox of screen.getAllByRole("checkbox"))
    expect(checkbox).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});

it("keeps required capabilities separate and omits consent controls in read-only details", () => {
  const { rerender } = render(<ExtensionDetails value={value} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByText(en["ext.permission.text:read"])).toBeVisible();
  rerender(
    <ExtensionDetails
      value={{
        ...value,
        manifest: { ...value.manifest, optionalPermissions: [] },
      }}
      consent={{ grants: [], disabled: false, onChange: vi.fn() }}
    />,
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Optional capabilities" }),
  ).not.toBeInTheDocument();
});

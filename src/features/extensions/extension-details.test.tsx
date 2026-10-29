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
  const group = screen.getByRole("group", {
    name: en["ext.optionalPermissions"],
  });
  const all = within(group).getByRole("checkbox", {
    name: en["ext.selectAllOptionalPermissions"],
  });
  const storage = within(group).getByRole("checkbox", {
    name: en["ext.permission.storage"],
  });
  expect(storage).toHaveAccessibleDescription(
    en["ext.permissionDescription.storage"],
  );
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
    name: en["ext.selectAllOptionalPermissions"],
  });
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(all).not.toBeChecked();
  expect(changed).not.toHaveBeenCalled();
  await user.click(all);
  expect(changed).toHaveBeenLastCalledWith(["storage"]);
});

it("reflects existing partial grants and disables the group while an operation is pending", async () => {
  const user = userEvent.setup();
  const changed = renderConsent({
    initial: ["text:read", "storage"],
    disabled: true,
  });
  const all = screen.getByRole("checkbox", {
    name: en["ext.selectAllOptionalPermissions"],
  });
  expect(all).toBePartiallyChecked();
  for (const checkbox of screen.getAllByRole("checkbox"))
    expect(checkbox).toBeDisabled();
  await user.click(all);
  await user.click(screen.getByText(en["ext.permission.storage"]));
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
    screen.queryByRole("group", { name: en["ext.optionalPermissions"] }),
  ).not.toBeInTheDocument();
});

it("keeps source and permissions visible, with useful technical fields collapsed and no hashes or fingerprints", async () => {
  const user = userEvent.setup();
  const fingerprint = "b".repeat(64);
  render(
    <ExtensionDetails
      value={{
        ...value,
        manifest: {
          ...value.manifest,
          commands: [
            {
              id: "app",
              title: "Open workspace",
              function: "app",
              inputFormat: "json",
              resultFormat: "view",
              permissions: [],
            },
          ],
          network: [{ origin: "https://service.example", methods: ["GET"] }],
        },
      }}
      origin={{
        kind: "market",
        source: {
          repository: "example/extensions",
          publicKeyFingerprint: fingerprint,
          catalogRevision: 7,
          packageSha256: "c".repeat(64),
        },
      }}
    />,
  );
  expect(screen.getByText(en["ext.source.market"])).toBeVisible();
  expect(screen.getByText(en["ext.source.marketHint"])).toBeVisible();
  expect(screen.getByText(en["ext.permission.text:read"])).toBeVisible();
  for (const technical of [
    value.manifest.id,
    "example/extensions",
    "https://service.example",
    "Open workspace (json → view)",
  ]) {
    expect(
      screen.getByText(technical, {
        exact:
          technical !== "example/extensions" &&
          technical !== "https://service.example",
      }),
    ).not.toBeVisible();
  }
  expect(screen.queryByText(value.sha256)).not.toBeInTheDocument();
  expect(screen.queryByText(fingerprint)).not.toBeInTheDocument();
  await user.click(screen.getByText(en["ext.technicalInfo"]));
  expect(screen.getByText(value.manifest.id)).toBeVisible();
  expect(screen.getByText(value.manifest.minHostVersion)).toBeVisible();
  expect(screen.getByText("example/extensions")).toBeVisible();
  expect(screen.getByText("https://service.example · GET")).toBeVisible();
  expect(screen.getByText("Open workspace (json → view)")).toBeVisible();
  expect(screen.queryByText(value.sha256)).not.toBeInTheDocument();
  expect(screen.queryByText(fingerprint)).not.toBeInTheDocument();
});

it("names each optional control separately from its description and retains extension-wide networking scope", () => {
  renderConsent({
    preview: {
      ...value,
      manifest: {
        ...value.manifest,
        optionalPermissions: [
          "network:images",
          "network:system-proxy",
          "messaging:lan",
        ],
      },
    },
  });
  for (const permission of [
    "network:images",
    "network:system-proxy",
    "messaging:lan",
  ] as const) {
    const checkbox = screen.getByRole("checkbox", {
      name: en[`ext.permission.${permission}`],
    });
    expect(checkbox).toHaveAccessibleDescription(
      en[`ext.permissionDescription.${permission}`],
    );
    expect(checkbox).not.toBeChecked();
  }
  expect(screen.getByText(en["ext.permissionScopeHint"])).toBeVisible();
  expect(
    screen.getByRole("group", { name: en["ext.requiredPermissions"] }),
  ).not.toContainElement(
    screen.getByRole("group", { name: en["ext.optionalPermissions"] }),
  );
});

it("omits repeated identity in installed details and shows which optional permissions are allowed", () => {
  render(
    <ExtensionDetails
      value={value}
      showIdentity={false}
      origin={{ kind: "local" }}
      grantedPermissions={["text:read", "storage"]}
    />,
  );
  expect(screen.queryByText(value.manifest.name)).not.toBeInTheDocument();
  expect(
    screen.queryByText(value.manifest.description),
  ).not.toBeInTheDocument();
  expect(screen.getByText(value.manifest.author)).toBeVisible();
  expect(screen.getByText(en["ext.source.localHint"])).toBeVisible();
  const storage = screen.getByText(en["ext.permission.storage"]).closest("li");
  const files = screen.getByText(en["ext.permission.files:read"]).closest("li");
  expect(storage).toHaveTextContent(en["ext.permissionAllowed"]);
  expect(files).toHaveTextContent(en["ext.permissionNotAllowed"]);
});

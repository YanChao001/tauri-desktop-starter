import { StrictMode, type ComponentProps } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionInfo, MarketEntry } from "@/lib/tauri";
import { ExtensionResources } from "./extension-resources";
import { ExtensionCard } from "./extension-card";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
const resources = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }));
vi.mock("./extension-resources", async () => {
  const { useEffect } = await import("react");
  return {
    ExtensionResources: vi.fn(() => {
      useEffect(() => {
        resources.mounted++;
        return () => {
          resources.unmounted++;
        };
      }, []);
      return <input aria-label="Service setup" />;
    }),
  };
});

const item: ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: ["storage"],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "example.workbench",
      version: "1.0.0",
      name: "Local Workbench",
      author: "Example",
      description: "A workspace for your notes and files.",
      permissions: [],
      optionalPermissions: ["storage", "network:https"],
      network: [{ origin: "https://service.example", methods: ["GET"] }],
      commands: [
        {
          id: "app",
          title: "Workbench",
          function: "app",
          inputFormat: "json",
          resultFormat: "view",
          ui: { sidebar: true, window: true },
          permissions: [],
        },
        {
          id: "cloud",
          title: "Cloud lookup",
          function: "cloud",
          inputFormat: "text",
          resultFormat: "text",
          permissions: ["network:https"],
        },
      ],
    },
  },
};
const update: MarketEntry = {
  package: {
    ...item.package,
    manifest: { ...item.package.manifest, version: "1.1.0" },
  },
  category: "tools",
  featured: false,
  releaseTag: "latest",
  asset: "workbench.json",
  packageSha256: "b".repeat(64),
  packageBytes: 200,
};
type CardProps = ComponentProps<typeof ExtensionCard>;
function renderCard(overrides: Partial<CardProps> = {}, strict = false) {
  const props: CardProps = {
    item,
    busy: false,
    update: null,
    onOpen: vi.fn(),
    onWindow: vi.fn(),
    onEnable: vi.fn(),
    onDisable: vi.fn(),
    onPermissions: vi.fn(),
    onUninstall: vi.fn(),
    onRollback: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  };
  const card = <ExtensionCard {...props} />;
  return { ...render(strict ? <StrictMode>{card}</StrictMode> : card), props };
}
beforeEach(() => {
  vi.clearAllMocks();
  resources.mounted = 0;
  resources.unmounted = 0;
});
afterEach(cleanup);

it("keeps all actions in a named keyboard menu with open as its first item", async () => {
  const user = userEvent.setup();
  const { props } = renderCard();
  expect(
    screen.queryByRole("button", { name: "Open" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Advanced settings")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Local Workbench" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Permissions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Uninstall" }),
  ).not.toBeInTheDocument();
  const more = screen.getByRole("button", {
    name: "Actions for Local Workbench",
  });
  more.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("Open");
  await user.keyboard("{Enter}");
  expect(props.onOpen).toHaveBeenCalledOnce();
  await user.keyboard("{ArrowDown}");
  expect(
    await screen.findByRole("menuitem", { name: "Permissions" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
  expect(more).toHaveFocus();
});

it("preserves callbacks and a lasting focus target for permission and destructive confirmations", async () => {
  const user = userEvent.setup();
  const focused: (Element | null)[] = [];
  const onPermissions = vi.fn(() => focused.push(document.activeElement));
  const onUninstall = vi.fn(() => focused.push(document.activeElement));
  renderCard({ onPermissions, onUninstall });
  const more = screen.getByRole("button", {
    name: "Actions for Local Workbench",
  });
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Permissions" }));
  expect(onPermissions).toHaveBeenCalledOnce();
  await user.click(more);
  const uninstall = screen.getByRole("menuitem", { name: "Uninstall" });
  expect(uninstall).toHaveAttribute("data-variant", "destructive");
  await user.click(uninstall);
  expect(onUninstall).toHaveBeenCalledOnce();
  expect(focused).toEqual([more, more]);
});

it("keeps window, update, rollback and disable actions available without bypassing command permissions", async () => {
  const user = userEvent.setup();
  const { props } = renderCard({
    item: { ...item, previousPackage: item.package },
    update,
  });
  const more = screen.getByRole("button", {
    name: "Actions for Local Workbench",
  });
  for (const [name, callback] of [
    ["New window", props.onWindow],
    ["Update to 1.1.0", props.onUpdate],
    ["Roll back to 1.0.0", props.onRollback],
    ["Disable", props.onDisable],
  ] as const) {
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name }));
    expect(callback).toHaveBeenCalledOnce();
  }
  expect(props.onWindow).toHaveBeenCalledWith("app");
  await user.click(more);
  const cloud = screen.getByRole("menuitem", {
    name: "Cloud lookup · Permission needed",
  });
  expect(cloud).toHaveAttribute("aria-disabled", "true");
  await user.click(cloud);
  expect(props.onOpen).not.toHaveBeenCalled();
  await user.click(screen.getByRole("menuitem", { name: "Workbench" }));
  expect(props.onOpen).toHaveBeenCalledWith("app");
});

it("offers enable for disabled extensions and locks its entry points during an operation", async () => {
  const user = userEvent.setup();
  const { props, rerender } = renderCard({ item: { ...item, enabled: false } });
  expect(
    screen.queryByRole("button", { name: "Enable" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Actions for Local Workbench" }),
  );
  expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("Enable");
  expect(screen.getByRole("menuitem", { name: "Enable" })).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "Disable" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Enable" }));
  expect(props.onEnable).toHaveBeenCalledOnce();
  rerender(<ExtensionCard {...props} busy />);
  expect(
    screen.getByRole("button", { name: "Actions for Local Workbench" }),
  ).toBeDisabled();
});

it("lazily opens named advanced settings and preserves its draft across dialog closes in StrictMode", async () => {
  const user = userEvent.setup();
  const view = renderCard({}, true);
  expect(ExtensionResources).not.toHaveBeenCalled();
  await user.click(screen.getByText("Details"));
  expect(screen.getByText("Author")).toBeVisible();
  expect(screen.getAllByText(item.package.manifest.description)).toHaveLength(
    1,
  );
  expect(ExtensionResources).not.toHaveBeenCalled();
  const more = screen.getByRole("button", {
    name: "Actions for Local Workbench",
  });
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Advanced settings" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Local Workbench · Advanced settings",
  });
  expect(dialog).toHaveAccessibleDescription(
    "Manage local plugin data and service connections.",
  );
  const setup = await screen.findByRole("textbox", { name: "Service setup" });
  await user.type(setup, "Keep my setup");
  const active = resources.mounted - resources.unmounted;
  expect(active).toBe(1);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(setup.isConnected).toBe(false);
  expect(more).toHaveFocus();
  expect(resources.mounted - resources.unmounted).toBe(active);
  expect(document.body).not.toHaveAttribute("data-scroll-locked");
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Advanced settings" }));
  expect(screen.getByRole("textbox", { name: "Service setup" })).toBe(setup);
  expect(setup).toHaveValue("Keep my setup");
  expect(resources.mounted - resources.unmounted).toBe(active);
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(more).toHaveFocus());
  view.unmount();
  expect(resources.mounted).toBe(resources.unmounted);
  expect(setup.parentElement).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body).not.toHaveAttribute("data-scroll-locked");
});

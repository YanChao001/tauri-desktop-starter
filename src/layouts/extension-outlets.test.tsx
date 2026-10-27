import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useExtensionActivity } from "@/features/extensions/extension-activity";
import type { ExtensionInfo } from "@/lib/tauri";
import { extensionPath } from "@/routes";
import { ExtensionOutlets } from "./extension-outlets";

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function extension(id: string): ExtensionInfo {
  return {
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
        id,
        version: "1.0.0",
        name: id,
        description: "Cached extension fixture",
        author: "Example",
        permissions: ["storage"],
        commands: [
          {
            id: "open",
            title: "Open",
            function: "open",
            inputFormat: "json",
            resultFormat: "view",
            permissions: ["storage"],
            ui: { sidebar: true, window: true },
          },
        ],
        minHostVersion: "0.1.0",
        optionalPermissions: [],
        network: [],
      },
    },
  };
}

function FakePage() {
  const { extensionId, commandId } = useParams();
  const active = useExtensionActivity();
  return (
    <section data-testid={`surface-${extensionId}`} data-active={active}>
      <output data-testid={`route-${extensionId}`}>
        {extensionId}/{commandId}
      </output>
      <input aria-label={`Draft ${extensionId}`} />
    </section>
  );
}

const ids = [
  "example.alpha",
  "example.beta",
  "example.gamma",
  "example.delta",
] as const;

function renderOutlets(items = ids.map(extension)) {
  function tree(current: readonly ExtensionInfo[]) {
    return (
      <MemoryRouter initialEntries={[extensionPath(ids[0], "open")]}>
        <nav>
          {ids.map((id) => (
            <Link key={id} to={extensionPath(id, "open")}>
              {id}
            </Link>
          ))}
          <Link to="/settings">Settings</Link>
        </nav>
        <Routes>
          <Route element={<ExtensionOutlets items={current} />}>
            <Route
              path="extensions/app/:extensionId/:commandId"
              element={<FakePage />}
            />
            <Route path="settings" element={<h1>Settings page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }
  const result = render(tree(items));
  return {
    update: (current: readonly ExtensionInfo[]) =>
      result.rerender(tree(current)),
    visit: (name: string) =>
      fireEvent.click(screen.getByRole("link", { name })),
  };
}

it("retains the same document and draft across navigation while each cached page keeps its own route and activity", () => {
  const { visit } = renderOutlets();
  const first = screen.getByTestId("surface-example.alpha");
  const draft = screen.getByRole("textbox", { name: "Draft example.alpha" });
  fireEvent.change(draft, { target: { value: "Keep this working draft" } });

  visit("Settings");
  expect(screen.getByRole("heading", { name: "Settings page" })).toBeVisible();
  expect(first).toBeInTheDocument();
  expect(first).not.toBeVisible();
  expect(first).toHaveAttribute("data-active", "false");
  expect(draft).toHaveValue("Keep this working draft");

  visit("example.beta");
  expect(screen.getByTestId("surface-example.alpha")).toBe(first);
  expect(screen.getByTestId("route-example.alpha")).toHaveTextContent(
    "example.alpha/open",
  );
  expect(screen.getByTestId("route-example.beta")).toHaveTextContent(
    "example.beta/open",
  );
  expect(first).toHaveAttribute("data-active", "false");
  expect(screen.getByTestId("surface-example.beta")).toHaveAttribute(
    "data-active",
    "true",
  );

  visit("example.alpha");
  expect(screen.getByTestId("surface-example.alpha")).toBe(first);
  expect(screen.getByRole("textbox", { name: "Draft example.alpha" })).toBe(
    draft,
  );
  expect(draft).toHaveValue("Keep this working draft");
  expect(first).toBeVisible();
  expect(first).toHaveAttribute("data-active", "true");
  expect(screen.getByTestId("surface-example.beta")).not.toBeVisible();
  expect(screen.getByTestId("surface-example.beta")).toHaveAttribute(
    "data-active",
    "false",
  );
});

it("bounds retained documents to three and evicts the least recently visited extension", () => {
  const { visit } = renderOutlets();
  const alpha = screen.getByTestId("surface-example.alpha");
  visit("example.beta");
  const beta = screen.getByTestId("surface-example.beta");
  visit("example.gamma");
  expect(screen.getAllByTestId(/^surface-/)).toHaveLength(3);

  visit("example.alpha");
  visit("example.delta");
  expect(screen.getAllByTestId(/^surface-/)).toHaveLength(3);
  expect(screen.getByTestId("surface-example.alpha")).toBe(alpha);
  expect(beta).not.toBeInTheDocument();
  expect(screen.queryByTestId("surface-example.beta")).not.toBeInTheDocument();
  expect(screen.getByTestId("surface-example.delta")).toBeVisible();

  visit("example.beta");
  expect(screen.getAllByTestId(/^surface-/)).toHaveLength(3);
  expect(screen.getByTestId("surface-example.beta")).not.toBe(beta);
  expect(
    screen.getByRole("textbox", { name: "Draft example.beta" }),
  ).toHaveValue("");
});

it.each([
  {
    reason: "installation generation changes",
    invalidate: (item: ExtensionInfo) => ({ ...item, generation: 2 }),
  },
  {
    reason: "the extension is disabled",
    invalidate: (item: ExtensionInfo) => ({ ...item, enabled: false }),
  },
  {
    reason: "a command permission is revoked",
    invalidate: (item: ExtensionInfo): ExtensionInfo => ({
      ...item,
      grantedPermissions: [],
    }),
  },
])(
  "unmounts a hidden document when $reason and returns to a fresh page after recovery",
  ({ invalidate }) => {
    const first = extension(ids[0]);
    const items = [first, ...ids.slice(1).map(extension)];
    const { visit, update } = renderOutlets(items);
    const old = screen.getByTestId("surface-example.alpha");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Draft example.alpha" }),
      {
        target: { value: "Old installation state" },
      },
    );
    visit("Settings");
    expect(old).toBeInTheDocument();

    const changed = invalidate(first);
    update([changed, ...items.slice(1)]);
    expect(old).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Settings page" }),
    ).toBeVisible();

    update([
      { ...changed, enabled: true, grantedPermissions: ["storage"] },
      ...items.slice(1),
    ]);
    visit("example.alpha");
    expect(screen.getByTestId("surface-example.alpha")).not.toBe(old);
    expect(screen.getByTestId("surface-example.alpha")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Draft example.alpha" }),
    ).toHaveValue("");
  },
);

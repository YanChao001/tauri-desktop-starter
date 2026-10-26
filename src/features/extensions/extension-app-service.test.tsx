import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { ExtensionUiRequest } from "./extension-ui-bridge";
import { ExtensionApp } from "./extension-app";

const surface = vi.hoisted(() => ({
  execute: null as ((request: ExtensionUiRequest) => Promise<unknown>) | null,
  busy: false,
  dirty: false,
}));
vi.mock("./extension-custom-ui", () => ({
  ExtensionCustomUi: (props: {
    execute: (request: ExtensionUiRequest) => Promise<unknown>;
    busy: boolean;
    dirty: boolean;
  }) => {
    surface.execute = props.execute;
    surface.busy = props.busy;
    surface.dirty = props.dirty;
    return <div>Custom plugin surface</div>;
  },
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  viewExtension: vi.fn(),
  cancelExtension: vi.fn(),
  requestExtensionService: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
vi.mock("@/providers/unsaved-work", () => ({ useUnsavedWork: vi.fn() }));

const item: native.ExtensionInfo = {
  generation: 7,
  enabled: true,
  origin: { kind: "local" },
  grantedPermissions: [],
  package: {
    bytes: 100,
    sha256: "b".repeat(64),
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "example.service-ui",
      name: "Service UI",
      author: "Example",
      description: "Service UI",
      version: "1.0.0",
      permissions: [],
      optionalPermissions: [],
      network: [],
      commands: [
        {
          id: "open",
          title: "Open",
          function: "app",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
          ui: { sidebar: true, window: true, document: "main" },
        },
      ],
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  surface.execute = null;
  surface.busy = false;
  surface.dirty = false;
  vi.mocked(native.viewExtension).mockResolvedValue({
    version: 2,
    state: "plugin state",
    display: "Service UI",
    description: "",
    fields: [],
    groups: [],
  });
});
afterEach(cleanup);

it.each([
  { service: "lan" as const, request: { action: "status" } },
  { service: "wallpaper" as const, request: { action: "list" } },
  {
    service: "resources" as const,
    request: {
      action: "fetch-image",
      url: "https://images.example.com/a.jpg",
      networkMode: "direct",
    },
  },
  {
    service: "links" as const,
    request: { url: "https://source.example.com/article" },
  },
])(
  "binds $service requests to the installed identity without locking Wasm actions or marking the session dirty",
  async ({ service, request }) => {
    let resolve!: (value: unknown) => void;
    vi.mocked(native.requestExtensionService).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      <ExtensionApp
        item={item}
        commandId="open"
        runs={[]}
        onClose={vi.fn()}
        onSettled={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await waitFor(() => expect(native.viewExtension).toHaveBeenCalledOnce());
    await waitFor(() => expect(surface.busy).toBe(false));
    let pending!: Promise<unknown>;
    act(() => {
      pending = surface.execute!({ method: "service", service, request });
    });
    expect(native.requestExtensionService).toHaveBeenCalledWith(
      item.package.manifest.id,
      item.package.sha256,
      item.generation,
      service,
      request,
    );
    expect(surface.busy).toBe(false);
    expect(surface.dirty).toBe(false);
    expect(native.viewExtension).toHaveBeenCalledOnce();
    await act(async () => {
      resolve({ status: "ready" });
      await expect(pending).resolves.toEqual({ status: "ready" });
    });
  },
);

it("propagates the native service rejection without replacing the plugin view or retrying the request", async () => {
  const rejected = { code: "INVALID_ARGUMENT", message: "Permission required" };
  vi.mocked(native.requestExtensionService).mockRejectedValueOnce(rejected);
  render(
    <ExtensionApp
      item={item}
      commandId="open"
      runs={[]}
      onClose={vi.fn()}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledOnce());
  await waitFor(() => expect(surface.busy).toBe(false));
  await expect(
    surface.execute!({
      method: "service",
      service: "lan",
      request: { action: "start" },
    }),
  ).rejects.toBe(rejected);
  expect(native.requestExtensionService).toHaveBeenCalledOnce();
  expect(native.viewExtension).toHaveBeenCalledOnce();
  expect(surface.dirty).toBe(false);
});

it.each([
  ["number", "1", "1e999"],
  ["date", "2026-10-26", "2026-02-30"],
  ["select", "one", "missing"],
  ["checkbox", "false", "invalid"],
] as const)(
  "rejects a %s draft in an SDK run before invoking Wasm and permits a corrected value",
  async (kind, initial, invalid) => {
    vi.mocked(native.viewExtension).mockResolvedValue({
      version: 2,
      state: "state",
      display: "Value",
      description: "",
      fields: [
        {
          id: "value",
          label: "Value",
          kind,
          value: initial,
          ...(kind === "select"
            ? { options: [{ label: "One", value: "one" }] }
            : {}),
        },
      ],
      groups: [],
    });
    render(
      <ExtensionApp
        item={item}
        commandId="open"
        runs={[]}
        onClose={vi.fn()}
        onSettled={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await waitFor(() => expect(surface.busy).toBe(false));
    await waitFor(() => expect(native.viewExtension).toHaveBeenCalledOnce());
    await act(async () => {
      await expect(
        surface.execute!({
          method: "run",
          action: "submit",
          fields: { value: invalid },
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });
    expect(native.viewExtension).toHaveBeenCalledOnce();
    await act(async () => {
      await surface.execute!({
        method: "run",
        action: "submit",
        fields: { value: initial },
      });
    });
    expect(native.viewExtension).toHaveBeenCalledTimes(2);
    expect(native.viewExtension).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ fields: { value: initial } }),
      }),
    );
  },
);

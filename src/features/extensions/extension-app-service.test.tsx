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

it.each(["lan", "wallpaper"] as const)(
  "binds %s requests to the installed identity without locking Wasm actions or marking the session dirty",
  async (service) => {
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
    const request = { action: "status" };
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

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { ExtensionUiRequest } from "./extension-ui-bridge";
import { ExtensionApp } from "./extension-app";
import { ExtensionActivityProvider } from "./extension-activity";

const surface = vi.hoisted(() => ({
  execute: null as ((request: ExtensionUiRequest) => Promise<unknown>) | null,
  busy: false,
  dirty: false,
}));
const locale = vi.hoisted(() => ({ language: "en" }));
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
  return {
    useI18n: () => ({ t: createTranslator(en), language: locale.language }),
  };
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
  locale.language = "en";
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
  {
    service: "lan" as const,
    request: { action: "status" },
    inactiveRequest: { action: "start" },
    result: { status: "ready" },
  },
  {
    service: "window" as const,
    request: { action: "get-state" },
    inactiveRequest: { action: "set-always-on-top", enabled: true },
    result: { alwaysOnTop: false },
  },
])(
  "rejects new $service requests from an inactive cached document while allowing an existing native operation to finish",
  async ({ service, request, inactiveRequest, result }) => {
    let finish!: (value: unknown) => void;
    vi.mocked(native.requestExtensionService).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const content = (active: boolean) => (
      <ExtensionActivityProvider active={active}>
        <ExtensionApp
          item={item}
          commandId="open"
          runs={[]}
          onClose={vi.fn()}
          onSettled={vi.fn().mockResolvedValue(undefined)}
        />
      </ExtensionActivityProvider>
    );
    const mounted = render(content(true));
    await waitFor(() => expect(native.viewExtension).toHaveBeenCalledOnce());
    await waitFor(() => expect(surface.busy).toBe(false));
    const pending = surface.execute!({
      method: "service",
      service,
      request,
    });
    mounted.rerender(content(false));
    await expect(
      surface.execute!({
        method: "service",
        service,
        request: inactiveRequest,
      }),
    ).rejects.toMatchObject({ code: "EXTENSION_UNAVAILABLE" });
    await expect(
      surface.execute!({ method: "checkpoint", value: "{}", dirty: true }),
    ).rejects.toMatchObject({ code: "EXTENSION_UNAVAILABLE" });
    expect(native.requestExtensionService).toHaveBeenCalledOnce();
    expect(native.cancelExtension).not.toHaveBeenCalled();
    await act(async () => {
      finish(result);
      await expect(pending).resolves.toEqual(result);
    });
    mounted.rerender(content(true));
    vi.mocked(native.requestExtensionService).mockResolvedValueOnce(result);
    await expect(
      surface.execute!({
        method: "service",
        service,
        request,
      }),
    ).resolves.toEqual(result);
    expect(native.requestExtensionService).toHaveBeenCalledTimes(2);
    expect(native.viewExtension).toHaveBeenCalledOnce();
  },
);

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
  { service: "window" as const, request: { action: "get-state" } },
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

function sourceView(
  provider: "commons" | "nekosbest",
  category = provider === "commons" ? "forest" : "neko",
): native.ExtensionView {
  return {
    version: 2,
    state: `${provider}:${category}`,
    display: "Dependent selects",
    description: "",
    fields: [
      {
        id: "provider",
        label: "Source",
        kind: "select",
        value: provider,
        maxBytes: 32,
        options: [
          { label: "Commons", value: "commons" },
          { label: "Nekos.best", value: "nekosbest" },
        ],
      },
      { id: "query", label: "Query", value: "", maxBytes: 400 },
      {
        id: "category",
        label: "Category",
        kind: "select",
        value: category,
        maxBytes: 64,
        options: (provider === "commons" ? ["all", "forest"] : ["neko"]).map(
          (value) => ({ label: value, value }),
        ),
      },
    ],
    groups: [],
  };
}

async function openCustomView(view: native.ExtensionView) {
  vi.mocked(native.viewExtension).mockResolvedValueOnce(view);
  const mounted = render(
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
  return mounted;
}

it("submits atomic parent and dependent-select changes against their new context in both directions", async () => {
  await openCustomView(sourceView("commons"));
  for (const provider of ["nekosbest", "commons"] as const) {
    const next = sourceView(provider);
    vi.mocked(native.viewExtension).mockResolvedValueOnce(next);
    const fields = Object.fromEntries(
      next.fields.map((field) => [field.id, field.value]),
    );
    await act(async () => {
      await expect(
        surface.execute!({ method: "run", action: "load", fields }),
      ).resolves.toEqual(next);
    });
    expect(native.viewExtension).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: item.package.manifest.id,
        commandId: "open",
        expectedSha256: item.package.sha256,
        expectedGeneration: item.generation,
        request: expect.objectContaining({ action: "load", fields }),
      }),
    );
  }
  expect(native.viewExtension).toHaveBeenCalledTimes(3);
  expect(native.requestExtensionService).not.toHaveBeenCalled();
});

it("stages dependent-select drafts with setFields and propagates a plugin rejection without retrying", async () => {
  await openCustomView(sourceView("commons"));
  const fields = { provider: "nekosbest", query: "", category: "neko" };
  await act(async () => {
    await expect(
      surface.execute!({ method: "fields", fields }),
    ).resolves.toBeNull();
  });
  expect(native.viewExtension).toHaveBeenCalledOnce();
  vi.mocked(native.viewExtension).mockResolvedValueOnce(
    sourceView("nekosbest"),
  );
  await act(async () => {
    await surface.execute!({ method: "run", action: "load", fields: {} });
  });
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ action: "load", fields }),
    }),
  );
  const rejected = new native.NativeBridgeError({
    code: "EXTENSION_RUN_FAILED",
    message: "Invalid source/category combination",
    retryable: false,
  });
  vi.mocked(native.viewExtension).mockRejectedValueOnce(rejected);
  await act(async () => {
    await expect(
      surface.execute!({
        method: "run",
        action: "load",
        fields: { category: "forest" },
      }),
    ).rejects.toBe(rejected);
  });
  expect(native.viewExtension).toHaveBeenCalledTimes(3);
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        fields: { ...fields, category: "forest" },
      }),
    }),
  );
  expect(native.requestExtensionService).not.toHaveBeenCalled();
});

it("refreshes the locale with staged dependent-select fields without reverting the new context", async () => {
  const mounted = await openCustomView(sourceView("commons"));
  const fields = { provider: "nekosbest", query: "", category: "neko" };
  await act(async () => {
    await surface.execute!({ method: "fields", fields });
  });
  vi.mocked(native.viewExtension).mockResolvedValueOnce(
    sourceView("nekosbest"),
  );
  locale.language = "zh";
  mounted.rerender(
    <ExtensionApp
      item={item}
      commandId="open"
      runs={[]}
      onClose={vi.fn()}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await waitFor(() => expect(native.viewExtension).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(surface.busy).toBe(false));
  expect(native.viewExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        action: null,
        locale: "zh-CN",
        fields,
      }),
    }),
  );
});

it.each([
  { label: "unknown field", patch: { undeclared: "value" } },
  { label: "author byte limit", patch: { provider: "图".repeat(11) } },
  { label: "non-string value", patch: { query: 123 } },
  { label: "null value", patch: { query: null } },
  { label: "NUL value", patch: { category: "neko\0" } },
])(
  "rejects $label before committing custom UI drafts or invoking Wasm",
  async ({ patch }) => {
    await openCustomView(sourceView("commons"));
    for (const method of ["fields", "run"] as const) {
      const fields = patch as unknown as Record<string, string>;
      await act(async () => {
        await expect(
          surface.execute!(
            method === "run"
              ? { method, action: "load", fields }
              : { method, fields },
          ),
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      });
    }
    expect(native.viewExtension).toHaveBeenCalledOnce();
    expect(surface.dirty).toBe(false);
  },
);

it("keeps the total custom UI field budget when dependent options are plugin validated", async () => {
  const view = sourceView("commons");
  view.fields = Array.from({ length: 5 }, (_, index) => ({
    id: `text${index}`,
    label: `Text ${index}`,
    value: "",
    maxBytes: 256 * 1024,
  }));
  await openCustomView(view);
  const fields = Object.fromEntries(
    view.fields.map((field) => [field.id, "x".repeat(256 * 1024)]),
  );
  await act(async () => {
    await expect(
      surface.execute!({ method: "run", action: "load", fields }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  expect(native.viewExtension).toHaveBeenCalledOnce();
  expect(surface.dirty).toBe(false);
});

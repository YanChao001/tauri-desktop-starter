import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as native from "@/lib/tauri";
import { ExtensionApp } from "./extension-app";
import type { ExtensionUiRequest } from "./extension-ui-bridge";

const surface = vi.hoisted(() => ({
  execute: null as ((request: ExtensionUiRequest) => Promise<unknown>) | null,
}));
vi.mock("./extension-custom-ui", () => ({
  ExtensionCustomUi: ({
    execute,
    view,
  }: {
    execute: (request: ExtensionUiRequest) => Promise<unknown>;
    view: native.ExtensionView | null;
  }) => {
    surface.execute = execute;
    return <div>{view?.display}</div>;
  },
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  viewExtension: vi.fn(),
  cancelExtension: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ t, language: "en" }) };
});
vi.mock("@/providers/unsaved-work", () => ({ useUnsavedWork: vi.fn() }));

const item: native.ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: [],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    uiDocuments: [{ id: "main", sha256: "b".repeat(64), bytes: 100 }],
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      id: "example.notifications",
      version: "1.0.0",
      name: "Wallpaper library",
      author: "Example",
      description: "A custom UI",
      minHostVersion: "0.1.0",
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
          ui: { document: "main", sidebar: true, window: true },
        },
      ],
    },
  },
};
const first: native.ExtensionView = {
  version: 2,
  state: "state",
  display: "Wallpaper results",
  description: "Results",
  fields: [],
  groups: [],
};
const settled = vi.fn().mockResolvedValue(undefined);
function app(enabled = true) {
  return (
    <ExtensionApp
      item={{ ...item, enabled }}
      commandId="open"
      runs={[]}
      onClose={vi.fn()}
      onSettled={settled}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  surface.execute = null;
  vi.mocked(native.viewExtension).mockResolvedValue(first);
  vi.mocked(native.cancelExtension).mockResolvedValue(undefined);
});
afterEach(cleanup);

it("renders notifications through the host toast, labels their source and keeps the plugin layout intact", async () => {
  const mounted = render(app());
  await screen.findByText("Wallpaper results");
  const before = mounted.container.innerHTML;
  for (const tone of ["info", "success", "error"] as const) {
    await act(async () => {
      await surface.execute!({
        method: "notify",
        message: "<img src=x onerror=alert(1)>",
        tone,
      });
    });
    expect(toast[tone]).toHaveBeenCalledExactlyOnceWith(
      "<img src=x onerror=alert(1)>",
      expect.objectContaining({ description: "Wallpaper library" }),
    );
  }
  expect(mounted.container.innerHTML).toBe(before);
  expect(document.querySelector("img")).toBeNull();
  expect(native.viewExtension).toHaveBeenCalledOnce();
  const ids = [toast.info, toast.success, toast.error].map(
    (notify) => vi.mocked(notify).mock.calls[0]?.[1]?.id,
  );
  expect(new Set(ids).size).toBe(1);
});

it("replaces an existing-view failure with a plugin message in the same host toast slot", async () => {
  render(app());
  await screen.findByText("Wallpaper results");
  vi.mocked(native.viewExtension).mockRejectedValueOnce({
    code: "EXTENSION_RUN_FAILED",
  });
  await act(async () => {
    await expect(
      surface.execute!({ method: "run", action: "search", fields: {} }),
    ).rejects.toEqual({ code: "EXTENSION_RUN_FAILED" });
  });
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  await act(async () => {
    await surface.execute!({
      method: "notify",
      message: "Search failed. Please try again.",
      tone: "error",
    });
  });
  const calls = vi.mocked(toast.error).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]?.[1]?.id).toBe(calls[0]?.[1]?.id);
  expect(calls[1]?.[0]).toBe("Search failed. Please try again.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Wallpaper results")).toBeVisible();
});

it("rejects notifications after disabling or disposing the session", async () => {
  const mounted = render(app());
  await screen.findByText("Wallpaper results");
  const request: ExtensionUiRequest = {
    method: "notify",
    message: "Too late",
    tone: "success",
  };
  mounted.rerender(app(false));
  await expect(surface.execute!(request)).rejects.toMatchObject({
    code: "EXTENSION_UNAVAILABLE",
  });
  mounted.rerender(app());
  const disposedExecute = surface.execute!;
  mounted.unmount();
  await expect(disposedExecute(request)).rejects.toMatchObject({
    code: "EXTENSION_UNAVAILABLE",
  });
  expect(toast.success).not.toHaveBeenCalled();
});

import { StrictMode, useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as native from "@/lib/tauri";
import {
  ExtensionsProvider,
  useExtensions,
  useExtensionSession,
} from "./extensions-provider";
import type { ExtensionSessionCache } from "./extension-session-cache";

const environment = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => environment.native,
  extensionSnapshot: vi.fn(),
  onExtensionsChanged: vi.fn(),
  prepareEnabledExtensions: vi.fn(),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
const snapshot: native.ExtensionSnapshot = {
  revision: 1,
  runs: [],
  items: [
    {
      generation: 1,
      origin: { kind: "local" },
      enabled: true,
      grantedPermissions: [],
      package: {
        sha256: "a".repeat(64),
        bytes: 100,
        manifest: {
          formatVersion: 3,
          apiVersion: 2,
          minHostVersion: "0.1.0",
          id: "fixture.prepare",
          name: "Prepared plugin",
          version: "1.0.0",
          author: "Test",
          description: "Startup preparation fixture",
          permissions: [],
          optionalPermissions: [],
          network: [],
          commands: [],
        },
      },
    },
  ],
};
let changed = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  environment.native = false;
  vi.mocked(native.extensionSnapshot).mockResolvedValue(snapshot);
  vi.mocked(native.prepareEnabledExtensions).mockResolvedValue(undefined);
  vi.mocked(native.onExtensionsChanged).mockImplementation(async (handler) => {
    changed = handler;
    return () => {};
  });
});
afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function preparationRetry() {
  const action = vi.mocked(toast.error).mock.calls[0]?.[1]?.action;
  if (!action || typeof action !== "object" || !("onClick" in action))
    throw new Error("Expected a retry action on the preparation failure toast");
  const retry = render(
    <button onClick={action.onClick}>Retry preparation</button>,
  );
  return retry.getByRole("button", { name: "Retry preparation" });
}
function StartupProbe() {
  const { data, loading } = useExtensions();
  return (
    <p>
      {loading ? "Loading" : (data?.items[0]?.package.manifest.name ?? "Empty")}
    </p>
  );
}

it("prepares startup plugins once through StrictMode without delaying the first snapshot or repeating on refresh", async () => {
  environment.native = true;
  const preparing = deferred();
  vi.mocked(native.prepareEnabledExtensions).mockReturnValueOnce(
    preparing.promise,
  );
  render(
    <StrictMode>
      <ExtensionsProvider>
        <StartupProbe />
      </ExtensionsProvider>
    </StrictMode>,
  );
  await screen.findByText("Prepared plugin");
  expect(native.prepareEnabledExtensions).toHaveBeenCalledOnce();
  expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  await act(async () => changed());
  expect(native.prepareEnabledExtensions).toHaveBeenCalledOnce();
  await act(async () => preparing.resolve());
  expect(toast.error).not.toHaveBeenCalled();
});

it("keeps the snapshot usable after startup preparation fails and retries only from the toast action", async () => {
  environment.native = true;
  vi.mocked(native.prepareEnabledExtensions).mockRejectedValueOnce({
    code: "EXTENSION_RUN_FAILED",
  });
  render(
    <ExtensionsProvider>
      <StartupProbe />
    </ExtensionsProvider>,
  );
  await screen.findByText("Prepared plugin");
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "ext.error.failed",
      expect.objectContaining({
        description: "ext.prepareFailedDescription",
        action: { label: "common.retry", onClick: expect.any(Function) },
      }),
    ),
  );
  await act(async () => changed());
  expect(native.prepareEnabledExtensions).toHaveBeenCalledOnce();
  const retry = preparationRetry();
  await act(async () => retry.click());
  expect(native.prepareEnabledExtensions).toHaveBeenCalledTimes(2);
  expect(toast.dismiss).toHaveBeenCalledWith("extension-startup-preparation");
  expect(screen.getByText("Prepared plugin")).toBeVisible();
});

it("ignores a late preparation failure and a retained retry action after the provider unmounts", async () => {
  environment.native = true;
  const preparing = deferred();
  vi.mocked(native.prepareEnabledExtensions)
    .mockRejectedValueOnce({ code: "EXTENSION_RUN_FAILED" })
    .mockReturnValueOnce(preparing.promise);
  const mounted = render(
    <ExtensionsProvider>
      <StartupProbe />
    </ExtensionsProvider>,
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  const retry = preparationRetry();
  await act(async () => retry.click());
  expect(native.prepareEnabledExtensions).toHaveBeenCalledTimes(2);
  mounted.unmount();
  await act(async () => preparing.reject({ code: "EXTENSION_RUN_FAILED" }));
  expect(toast.error).toHaveBeenCalledOnce();
  retry.click();
  expect(native.prepareEnabledExtensions).toHaveBeenCalledTimes(2);
});

it("does not turn subsequent refreshes into startup preparation after an empty initial snapshot", async () => {
  environment.native = true;
  vi.mocked(native.extensionSnapshot).mockResolvedValueOnce({
    revision: 0,
    items: [],
    runs: [],
  });
  render(
    <ExtensionsProvider>
      <StartupProbe />
    </ExtensionsProvider>,
  );
  await screen.findByText("Empty");
  await act(async () => changed());
  await screen.findByText("Prepared plugin");
  expect(native.prepareEnabledExtensions).not.toHaveBeenCalled();
});

it("protects every mounted session through StrictMode and releases only the unmounted clean entries", async () => {
  let cache: ExtensionSessionCache | undefined;
  function Session({ id }: { id: string }) {
    useExtensionSession(id, id);
    return null;
  }
  function Probe() {
    const { sessionCache } = useExtensions();
    useEffect(() => {
      cache = sessionCache;
    }, [sessionCache]);
    return null;
  }
  function workspace(start: number) {
    return (
      <StrictMode>
        <ExtensionsProvider>
          <Probe />
          {Array.from(
            { length: 14 - start },
            (_, index) => `${index + start}`,
          ).map((id) => (
            <Session key={id} id={id} />
          ))}
        </ExtensionsProvider>
      </StrictMode>
    );
  }
  const mounted = render(workspace(0));
  await act(async () => {});
  expect(cache?.sessions.size).toBe(14);
  const kept = cache?.sessions.get("2");
  mounted.rerender(workspace(2));
  await act(async () => {});
  expect(cache?.sessions.size).toBe(12);
  expect(cache?.sessions.has("0")).toBe(false);
  expect(cache?.sessions.has("1")).toBe(false);
  expect(cache?.sessions.get("2")).toBe(kept);
});

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AppCommand } from "@/commands/types";
import type { ExtensionSnapshot } from "@/lib/tauri";
import * as native from "@/lib/tauri";
import { ExtensionCommands } from "./extension-commands";
import { ExtensionsProvider } from "./extensions-provider";

const registered = vi.hoisted(() => ({
  commands: [] as readonly AppCommand[],
}));
vi.mock("@/providers/commands", () => ({
  useRegisterCommands: (commands: readonly AppCommand[]) => {
    registered.commands = commands;
  },
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  extensionSnapshot: vi.fn(),
  onExtensionsChanged: vi.fn(),
}));
const snapshot: ExtensionSnapshot = {
  revision: 1,
  runningId: null,
  items: [
    {
      enabled: true,
      grantedPermissions: [],
      package: {
        bytes: 100,
        sha256: "a".repeat(64),
        manifest: {
          formatVersion: 2,
          apiVersion: 1,
          id: "test.plugin",
          version: "1.0.0",
          name: "Plugin",
          author: "Test",
          description: "Test plugin",
          inputFormat: "text",
          resultFormat: "text",
          permissions: [],
          allowedHosts: [],
          commands: [{ id: "run", title: "Run tool", function: "run" }],
        },
      },
    },
  ],
};
let changed: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  registered.commands = [];
  vi.mocked(native.extensionSnapshot).mockResolvedValue(snapshot);
  vi.mocked(native.onExtensionsChanged).mockImplementation(async (handler) => {
    changed = handler;
    return () => {};
  });
});
afterEach(cleanup);
function Location() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}
it("namespaces enabled commands and opens their runner without executing plugin code", async () => {
  render(
    <MemoryRouter>
      <ExtensionsProvider>
        <ExtensionCommands />
      </ExtensionsProvider>
      <Location />
    </MemoryRouter>,
  );
  await waitFor(() => expect(registered.commands).toHaveLength(1));
  expect(registered.commands[0]?.id).toBe("extension:test.plugin:run");
  await act(async () => {
    await registered.commands[0]?.run();
  });
  expect(
    screen.getByText("/extensions?extension=test.plugin&command=run"),
  ).toBeVisible();
});
it("an older snapshot cannot restore commands after a revocation", async () => {
  render(
    <MemoryRouter>
      <ExtensionsProvider>
        <ExtensionCommands />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(registered.commands).toHaveLength(1));
  let old!: (value: ExtensionSnapshot) => void;
  vi.mocked(native.extensionSnapshot)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        old = resolve;
      }),
    )
    .mockResolvedValueOnce({ revision: 2, items: [], runningId: null });
  await act(async () => {
    changed();
    changed();
  });
  await waitFor(() => expect(registered.commands).toHaveLength(0));
  await act(async () => {
    old(snapshot);
  });
  expect(registered.commands).toHaveLength(0);
});
it("releases a listener received after unmount and does not read a snapshot", async () => {
  let resolve!: (stop: () => void) => void;
  const stop = vi.fn();
  vi.mocked(native.onExtensionsChanged).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(
    <MemoryRouter>
      <ExtensionsProvider>
        <ExtensionCommands />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  view.unmount();
  await act(async () => {
    resolve(stop);
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(native.extensionSnapshot).not.toHaveBeenCalled();
});

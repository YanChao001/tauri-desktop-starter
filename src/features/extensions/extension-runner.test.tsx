import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import type { UnsavedWork } from "@/providers/unsaved-work";
import { ExtensionRunner } from "./extension-runner";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  runExtension: vi.fn(),
  cancelExtension: vi.fn(),
  saveTextExport: vi.fn(),
  pickWorkbenchFiles: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
const lifecycle = vi.hoisted(() => ({ work: null as UnsavedWork | null }));
vi.mock("@/providers/unsaved-work", () => ({
  useUnsavedWork: (work: UnsavedWork) => {
    lifecycle.work = work;
  },
}));
const tool: native.ExtensionInfo = {
  package: {
    manifest: {
      formatVersion: 2,
      apiVersion: 1,
      id: "test.tool",
      version: "1.0.0",
      name: "Test tool",
      author: "Test",
      description: "Tool",
      inputFormat: "text",
      resultFormat: "text",
      commands: [{ id: "run", title: "Run", function: "run" }],
      permissions: ["text:read"],
      allowedHosts: [],
    },
    sha256: "a".repeat(64),
    bytes: 100,
  },
  enabled: true,
  grantedPermissions: ["text:read"],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.cancelExtension).mockResolvedValue(undefined);
  vi.mocked(native.saveTextExport).mockResolvedValue("saved.json");
});
afterEach(cleanup);

it("exports the actual final result when completion races with lifecycle cancellation", async () => {
  const nativeRun = deferred<string>();
  vi.mocked(native.runExtension).mockReturnValueOnce(nativeRun.promise);
  render(
    <ExtensionRunner
      items={[tool]}
      runningId={null}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  const saving = lifecycle.work!.save();
  await act(async () => {
    nativeRun.resolve("Final result before stop");
    await saving;
  });
  expect(native.saveTextExport).toHaveBeenCalledWith(
    "extension-session.json",
    expect.stringContaining("Final result before stop"),
  );
});

it("keeps input and previous output after failure and leaves a cancelled export dirty", async () => {
  vi.mocked(native.runExtension)
    .mockResolvedValueOnce("<script>plain text</script>")
    .mockRejectedValueOnce({ code: "EXTENSION_RUN_FAILED" });
  render(
    <ExtensionRunner
      items={[tool]}
      runningId={null}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "Keep this input" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  await screen.findByText("<script>plain text</script>");
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Input text")).toHaveValue("Keep this input");
  expect(screen.getByText("<script>plain text</script>")).toBeVisible();
  vi.mocked(native.saveTextExport).mockResolvedValueOnce(null);
  await act(async () => {
    await expect(lifecycle.work!.save()).rejects.toMatchObject({
      code: "USER_CANCELLED",
    });
  });
  expect(lifecycle.work?.dirty).toBe(true);
  await act(async () => {
    await lifecycle.work!.save();
  });
  expect(lifecycle.work?.dirty).toBe(false);
  expect(native.saveTextExport).toHaveBeenLastCalledWith(
    "extension-session.json",
    expect.stringContaining("Keep this input"),
  );
});

it("keeps its run occupied until native cancellation completes and cancels on unmount", async () => {
  const nativeRun = deferred<string>();
  vi.mocked(native.runExtension).mockReturnValueOnce(nativeRun.promise);
  const view = render(
    <ExtensionRunner
      items={[tool]}
      runningId={null}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  fireEvent.click(screen.getByRole("button", { name: "Request stop" }));
  await waitFor(() =>
    expect(native.cancelExtension).toHaveBeenCalledWith("test.tool"),
  );
  expect(screen.getByRole("button", { name: "Run extension" })).toBeDisabled();
  expect(lifecycle.work?.dirty).toBe(true);
  view.unmount();
  expect(native.cancelExtension).toHaveBeenCalledTimes(2);
  await act(async () => nativeRun.reject({ code: "USER_CANCELLED" }));
});

it("does not clear or save anything for an already aborted lifecycle request", async () => {
  render(
    <ExtensionRunner
      items={[tool]}
      runningId={null}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "Retain" },
  });
  const controller = new AbortController();
  controller.abort();
  await expect(lifecycle.work!.save(controller.signal)).rejects.toThrow();
  await expect(lifecycle.work!.discard(controller.signal)).rejects.toThrow();
  expect(native.saveTextExport).not.toHaveBeenCalled();
  expect(native.runExtension).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Input text")).toHaveValue("Retain");
});

it("waits for an active file picker and exports the selection that actually completed", async () => {
  const selecting = deferred<native.WorkbenchDocument[]>();
  vi.mocked(native.pickWorkbenchFiles).mockReturnValueOnce(selecting.promise);
  render(
    <ExtensionRunner
      items={[{ ...tool, grantedPermissions: ["files:read"] }]}
      runningId={null}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose text files for this run" }),
  );
  expect(lifecycle.work?.dirty).toBe(true);
  const saving = lifecycle.work!.save();
  expect(native.saveTextExport).not.toHaveBeenCalled();
  await act(async () => {
    selecting.resolve([
      {
        id: "selected",
        name: "new-selection.txt",
        path: "C:/new-selection.txt",
        kind: "text",
        content: "saved text",
        bytes: 10,
        previewUrl: null,
        revision: "revision",
      },
    ]);
    await saving;
  });
  expect(native.saveTextExport).toHaveBeenCalledWith(
    "extension-session.json",
    expect.stringContaining('"new-selection.txt"'),
  );
  expect(lifecycle.work?.dirty).toBe(false);
});

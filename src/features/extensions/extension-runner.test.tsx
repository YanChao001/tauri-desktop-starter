import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import * as native from "@/lib/tauri";
import type { UnsavedWork } from "@/providers/unsaved-work";
import { ExtensionRunner } from "./extension-runner";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  runExtension: vi.fn(),
  cancelExtension: vi.fn(),
  saveTextExport: vi.fn(),
  pickExtensionFiles: vi.fn(),
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
  generation: 1,
  origin: { kind: "local" },
  package: {
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      id: "test.tool",
      version: "1.0.0",
      name: "Test tool",
      author: "Test",
      description: "Tool",
      commands: [
        {
          id: "run",
          title: "Run",
          function: "run",
          inputFormat: "text",
          resultFormat: "text",
          permissions: [],
        },
      ],
      permissions: ["text:read"],
      minHostVersion: "0.1.0",
      optionalPermissions: [],
      network: [],
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps short runs locked without flashing progress or changing the feedback controls", async () => {
  const pending = deferred<string>();
  vi.mocked(native.runExtension).mockReturnValueOnce(pending.promise);
  render(
    <ExtensionRunner
      items={[tool]}
      runs={[]}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  const run = screen.getByRole("button", { name: "Run extension" });
  const stop = screen.getByText("Request stop", { selector: "button" });
  const status = screen.getByRole("status", { name: "Execution status" });
  vi.useFakeTimers();
  fireEvent.click(run);
  expect(run).toBeDisabled();
  expect(stop).not.toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
    pending.resolve("Fast result");
  });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(screen.getByText("Fast result")).toBeVisible();
  expect(run).toBeEnabled();
  expect(stop).not.toBeVisible();
  expect(screen.getByRole("status", { name: "Execution status" })).toBe(status);
  expect(status).toBeEmptyDOMElement();
});

it("exports the actual final result when completion races with lifecycle cancellation", async () => {
  const nativeRun = deferred<string>();
  vi.mocked(native.runExtension).mockReturnValueOnce(nativeRun.promise);
  render(
    <ExtensionRunner
      items={[tool]}
      runs={[]}
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
      runs={[]}
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
      runs={[]}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  expect(
    screen.queryByRole("button", { name: "Request stop" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Request stop" }));
  await waitFor(() =>
    expect(native.cancelExtension).toHaveBeenCalledWith("test.tool", 1),
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
      runs={[]}
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
  const selecting = deferred<native.ExtensionFileChoice[]>();
  vi.mocked(native.pickExtensionFiles).mockReturnValueOnce(selecting.promise);
  render(
    <ExtensionRunner
      items={[{ ...tool, grantedPermissions: ["files:read"] }]}
      runs={[]}
      onSettled={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose files for this run" }),
  );
  expect(lifecycle.work?.dirty).toBe(true);
  const saving = lifecycle.work!.save();
  expect(native.saveTextExport).not.toHaveBeenCalled();
  await act(async () => {
    selecting.resolve([
      {
        id: "selected",
        name: "new-selection.txt",
        mediaType: "text/plain",
        bytes: 10,
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

it("keeps an old installation's exportable draft without sending it to a same-hash replacement", async () => {
  const user = userEvent.setup();
  const late = deferred<string>();
  vi.mocked(native.runExtension)
    .mockResolvedValueOnce("Previous result")
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce("New installation result");
  const props = { runs: [], onSettled: vi.fn().mockResolvedValue(undefined) };
  const mounted = render(<ExtensionRunner items={[tool]} {...props} />);
  fireEvent.change(screen.getByLabelText("Input text"), {
    target: { value: "Old installation draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  await screen.findByText("Previous result");
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  mounted.rerender(
    <ExtensionRunner items={[{ ...tool, generation: 2 }]} {...props} />,
  );
  await act(async () => late.resolve("Late old result"));
  expect(screen.queryByText("Late old result")).not.toBeInTheDocument();
  expect(screen.getByText("Previous result")).toBeVisible();
  expect(screen.getByRole("button", { name: "Run extension" })).toBeDisabled();
  await act(async () => lifecycle.work!.save());
  const saved = JSON.parse(
    String(vi.mocked(native.saveTextExport).mock.calls.at(-1)?.[1]),
  ) as { extensionId: string; inputText: string; result: { text: string } };
  expect(saved).toMatchObject({
    extensionId: "test.tool",
    inputText: "Old installation draft",
    result: { text: "Previous result" },
  });
  screen.getByRole("combobox", { name: "Select an extension command" }).focus();
  await user.keyboard("{ArrowDown}");
  const option = await screen.findByRole("option", { name: "Test tool · Run" });
  option.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("Input text")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Run extension" }));
  await screen.findByText("New installation result");
  expect(native.runExtension).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedGeneration: 2, inputText: "" }),
  );
});

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { extensionRunStatus, type ExtensionSnapshot } from "@/lib/tauri";
import { useExtensionPhase } from "./use-extension-phase";

vi.mock("@/lib/tauri", () => ({
  extensionRunStatus: vi.fn(),
  getCurrentWindowLabel: vi.fn().mockResolvedValue("main"),
  isTauri: () => true,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("polls only run metadata while active, waits for slow queries and stops after deactivation", async () => {
  vi.useFakeTimers();
  let resolve!: (runs: ExtensionSnapshot["runs"]) => void;
  const pending = new Promise<ExtensionSnapshot["runs"]>((done) => {
    resolve = done;
  });
  vi.mocked(extensionRunStatus)
    .mockReturnValueOnce(pending)
    .mockResolvedValue([]);
  const initial: ExtensionSnapshot["runs"] = [
    { id: "app", owner: "main", phase: "queued" },
  ];
  const { result, rerender } = renderHook(
    ({ active }) => useExtensionPhase(initial, "app", active),
    { initialProps: { active: false } },
  );
  await act(async () => {});
  expect(result.current).toBe("queued");
  expect(extensionRunStatus).not.toHaveBeenCalled();
  rerender({ active: true });
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(extensionRunStatus).toHaveBeenCalledOnce();
  await act(async () => {
    resolve([{ id: "app", owner: "main", phase: "running" }]);
  });
  expect(result.current).toBe("running");
  await act(() => vi.advanceTimersByTimeAsync(750));
  expect(extensionRunStatus).toHaveBeenCalledTimes(2);
  rerender({ active: false });
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(result.current).toBe("queued");
  expect(extensionRunStatus).toHaveBeenCalledTimes(2);
});

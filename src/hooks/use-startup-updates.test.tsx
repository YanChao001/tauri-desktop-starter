import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getCurrentWindowLabel, type UpdateStatus } from "@/lib/tauri";
import { checkUpdates } from "@/lib/updates-store";
import { useStartupUpdates } from "./use-startup-updates";

const state = vi.hoisted(() => ({
  native: true,
  enabled: true,
  persistence: "saved",
  phase: "idle",
  status: null as UpdateStatus | null,
  navigate: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => state.native,
  getCurrentWindowLabel: vi.fn(async () => "main"),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({
    settings: { autoCheckUpdates: state.enabled },
    persistence: state.persistence,
  }),
}));
vi.mock("@/lib/updates-store", () => ({
  checkUpdates: vi.fn(async () => {
    state.phase = "ready";
  }),
  getUpdatesSnapshot: () => ({ phase: state.phase, status: state.status }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.navigate }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ language: "en", t: createTranslator(en) }) };
});
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));

async function advance() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

describe("startup update checks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(getCurrentWindowLabel).mockResolvedValue("main");
    Object.assign(state, {
      native: true,
      enabled: true,
      persistence: "saved",
      phase: "idle",
      status: null,
    });
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for settings and performs one delayed check in StrictMode", async () => {
    state.persistence = "loading";
    const view = renderHook(useStartupUpdates, { wrapper: StrictMode });
    await advance();
    expect(checkUpdates).not.toHaveBeenCalled();
    state.persistence = "saved";
    view.rerender();
    await advance();
    expect(checkUpdates).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event("visibilitychange"));
    await advance();
    expect(checkUpdates).toHaveBeenCalledOnce();
  });

  it.each(["browser", "disabled", "secondary"])(
    "skips checks for %s",
    async (mode) => {
      if (mode === "browser") state.native = false;
      if (mode === "disabled") state.enabled = false;
      if (mode === "secondary")
        vi.mocked(getCurrentWindowLabel).mockResolvedValue("secondary");
      renderHook(useStartupUpdates);
      await advance();
      expect(checkUpdates).not.toHaveBeenCalled();
    },
  );

  it("defers a hidden window until it becomes visible", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    renderHook(useStartupUpdates);
    await advance();
    expect(checkUpdates).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance();
    expect(checkUpdates).toHaveBeenCalledOnce();
  });

  it("keeps a manual check in progress and suppresses background failures", async () => {
    state.phase = "checking";
    renderHook(useStartupUpdates);
    await advance();
    expect(checkUpdates).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("does not repeat a failed background check or show an error toast", async () => {
    vi.mocked(checkUpdates).mockImplementationOnce(async () => {
      state.phase = "error";
    });
    renderHook(useStartupUpdates);
    await advance();
    document.dispatchEvent(new Event("visibilitychange"));
    await advance();
    expect(checkUpdates).toHaveBeenCalledOnce();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("notifies about an available release without navigating until the action is selected", async () => {
    state.status = {
      operationId: 1,
      configured: true,
      available: true,
      currentVersion: "1.0.0",
      endpoint: "https://example.com/latest.json",
      checkedAt: Date.now(),
      version: "1.1.0",
      body: null,
      date: null,
    };
    renderHook(useStartupUpdates);
    await advance();
    expect(toast.info).toHaveBeenCalledWith(
      "Version 1.1.0 is available",
      expect.objectContaining({ id: "available-update" }),
    );
    expect(state.navigate).not.toHaveBeenCalled();
    const options = vi.mocked(toast.info).mock.calls[0]?.[1];
    const action = options?.action;
    if (!action || typeof action !== "object" || !("onClick" in action))
      throw new Error("Missing update action");
    action.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    expect(state.navigate).toHaveBeenCalledWith("/updates");
  });

  it("drops a late window lookup after cleanup", async () => {
    let resolve!: (label: string) => void;
    vi.mocked(getCurrentWindowLabel).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = renderHook(useStartupUpdates);
    await advance();
    view.unmount();
    await act(async () => resolve("main"));
    expect(checkUpdates).not.toHaveBeenCalled();
  });
});

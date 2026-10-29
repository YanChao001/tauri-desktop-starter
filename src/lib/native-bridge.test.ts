import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, settingsDocument } from "@/lib/settings-model";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  NativeBridgeError,
  createNote,
  getDesktopStatus,
  loadSettingsSnapshot,
  onNotesChanged,
  onSettingsChanged,
  recordFrontendError,
  saveSettingsSnapshot,
  resetSettingsSnapshot,
  updateNote,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "secondary" }),
}));

describe("generated native bridge", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.resetAllMocks();
  });

  it("turns stable Rust error DTOs into errors with code and retryability", async () => {
    vi.mocked(invoke).mockRejectedValue({
      code: "SETTINGS_CONFLICT",
      message: "reload",
      retryable: true,
    });
    await expect(loadSettingsSnapshot()).rejects.toBeInstanceOf(
      NativeBridgeError,
    );
    await expect(loadSettingsSnapshot()).rejects.toMatchObject({
      code: "SETTINGS_CONFLICT",
      message: "reload",
      retryable: true,
    });
  });

  it("uses Rust-generated command payloads for notes and optimistic versions", async () => {
    const note = {
      id: 1,
      title: "A",
      body: "B",
      updatedAt: "2026-01-01",
      version: 1,
    };
    vi.mocked(invoke).mockResolvedValue(note);
    await expect(createNote({ title: "A", body: "B" })).resolves.toEqual(note);
    expect(invoke).toHaveBeenLastCalledWith("create_note", {
      input: { title: "A", body: "B" },
    });
    await updateNote({ id: 1, title: "C", body: "D", expectedVersion: 1 });
    expect(invoke).toHaveBeenLastCalledWith("update_note", {
      input: { id: 1, title: "C", body: "D", expectedVersion: 1 },
    });
  });

  it.each([
    ["save", saveSettingsSnapshot, "save_settings_snapshot"],
    ["reset", resetSettingsSnapshot, "reset_settings_snapshot"],
  ] as const)(
    "%s passes a detached settings document and expected revision",
    async (_label, persist, command) => {
      const document = settingsDocument({
        ...DEFAULT_SETTINGS,
        language: "en",
        runInBackground: false,
      });
      const snapshot = { revision: 2, settings: document };
      vi.mocked(invoke).mockResolvedValue(snapshot);
      await expect(persist(document, 1)).resolves.toEqual(snapshot);
      expect(invoke).toHaveBeenLastCalledWith(command, {
        settings: document,
        expectedRevision: 1,
      });
      const sent = vi.mocked(invoke).mock.calls[0]?.[1] as {
        settings?: unknown;
      };
      expect(sent.settings).not.toBe(document);
    },
  );

  it("subscribes to shared settings and notes events and returns cleanup", async () => {
    const stop = vi.fn();
    vi.mocked(listen).mockResolvedValue(stop);
    const changed = vi.fn();
    expect(await onSettingsChanged(changed)).toBe(stop);
    expect(listen).toHaveBeenCalledExactlyOnceWith(
      "app://settings-changed",
      expect.any(Function),
      { target: { kind: "WebviewWindow", label: "secondary" } },
    );
    const callback = vi.mocked(listen).mock.calls[0]?.[1];
    expect(callback).toBeDefined();
    callback?.({
      event: "app://settings-changed",
      id: 1,
      payload: { revision: 3, settings: { language: "en" } },
    });
    expect(changed).toHaveBeenCalledWith({
      revision: 3,
      settings: { language: "en" },
    });
    expect(await onNotesChanged(changed)).toBe(stop);
    expect(listen).toHaveBeenLastCalledWith(
      "app://notes-changed",
      expect.any(Function),
      { target: { kind: "WebviewWindow", label: "secondary" } },
    );
  });

  it("bounds error logs without splitting Unicode characters", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await recordFrontendError({
      message: "🌸".repeat(1100),
      stack: "s".repeat(9000),
      componentStack: "a" + "中".repeat(3000),
    });
    expect(invoke).toHaveBeenLastCalledWith("record_frontend_error", {
      error: {
        message: "🌸".repeat(1024),
        stack: "s".repeat(8192),
        componentStack: "a" + "中".repeat(2730),
      },
    });
  });

  it("browser previews cannot claim native support or write native logs", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    await expect(getDesktopStatus()).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    await recordFrontendError({ message: "browser" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

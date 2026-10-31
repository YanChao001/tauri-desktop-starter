import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as native from "@/lib/tauri";
import { DesktopSettings } from "./desktop-settings";
const update = vi.hoisted(() => vi.fn());
const preferences = vi.hoisted(() => ({ runInBackground: false }));
vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => true),
  getDesktopStatus: vi.fn(),
  getAutostartEnabled: vi.fn(),
  setAutostartEnabled: vi.fn(),
  openSecondaryWindow: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ language: "en", t: createTranslator(en) }) };
});
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: preferences, update }),
}));
vi.mock("@/components/settings-persistence", () => ({
  SettingsPersistence: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
describe("desktop controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(native.isTauri).mockReturnValue(true);
    preferences.runInBackground = false;
    vi.mocked(native.getDesktopStatus).mockResolvedValue({
      autostartSupported: true,
      trayAvailable: true,
      secondaryOpen: false,
      runInBackground: false,
    });
    vi.mocked(native.getAutostartEnabled).mockResolvedValue(false);
  });
  afterEach(cleanup);
  it("keeps native autostart state after failure and allows a successful retry", async () => {
    vi.mocked(native.setAutostartEnabled).mockRejectedValueOnce({
      code: "AUTOSTART_ERROR",
    });
    render(<DesktopSettings />);
    const toggle = screen.getByRole("switch", { name: "Launch at login" });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    vi.mocked(native.setAutostartEnabled).mockResolvedValueOnce(true);
    vi.mocked(native.getAutostartEnabled).mockResolvedValue(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(native.setAutostartEnabled).toHaveBeenCalledTimes(2);
  });
  it("deduplicates opening windows and suppresses late notifications after navigation", async () => {
    const opening = deferred<void>();
    vi.mocked(native.openSecondaryWindow).mockReturnValueOnce(opening.promise);
    const view = render(<DesktopSettings />);
    const button = screen.getByRole("button", { name: "New window" });
    await waitFor(() => expect(button).toBeEnabled());
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(native.openSecondaryWindow).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => opening.reject(new Error("closed")));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("disables background and autostart choices that the native host cannot support", async () => {
    vi.mocked(native.getDesktopStatus).mockResolvedValue({
      autostartSupported: false,
      trayAvailable: false,
      secondaryOpen: false,
      runInBackground: false,
    });
    render(<DesktopSettings />);
    await waitFor(() => expect(native.getDesktopStatus).toHaveBeenCalled());
    expect(
      screen.getByRole("switch", { name: "Launch at login" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", {
        name: "Run in background after closing",
      }),
    ).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
    expect(native.getAutostartEnabled).not.toHaveBeenCalled();
  });
  it("keeps all desktop controls disabled in the browser even with a saved background preference", async () => {
    vi.mocked(native.isTauri).mockReturnValue(false);
    preferences.runInBackground = true;
    render(<DesktopSettings />);
    expect(
      screen.getByText(/can only be changed in the desktop app/),
    ).toBeVisible();
    const background = screen.getByRole("switch", {
      name: "Run in background after closing",
    });
    expect(background).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Launch at login" }),
    ).toBeDisabled();
    const open = screen.getByRole("button", { name: "New window" });
    expect(open).toBeDisabled();
    fireEvent.click(background);
    fireEvent.click(open);
    await act(async () => {});
    expect(native.getDesktopStatus).not.toHaveBeenCalled();
    expect(native.setAutostartEnabled).not.toHaveBeenCalled();
    expect(native.openSecondaryWindow).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("updates the shared background preference when a tray is available", async () => {
    render(<DesktopSettings />);
    const background = screen.getByRole("switch", {
      name: "Run in background after closing",
    });
    await waitFor(() => expect(background).toBeEnabled());
    fireEvent.click(background);
    expect(update).toHaveBeenCalledWith({ runInBackground: true });
  });
});

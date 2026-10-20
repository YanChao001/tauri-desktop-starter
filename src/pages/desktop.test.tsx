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
import Desktop from "./desktop";
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
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
  useSettings: () => ({ settings: { runInBackground: false }, update }),
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
    render(<Desktop />);
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
    const view = render(<Desktop />);
    const button = screen.getByRole("button", { name: "Open a second window" });
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
    render(<Desktop />);
    await waitFor(() => expect(native.getDesktopStatus).toHaveBeenCalled());
    expect(
      screen.getByRole("switch", { name: "Launch at login" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", {
        name: "Keep running after closing a window",
      }),
    ).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
    expect(native.getAutostartEnabled).not.toHaveBeenCalled();
  });
});

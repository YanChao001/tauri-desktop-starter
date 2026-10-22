import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { UpdateStatus, UpdateProgress } from "@/lib/tauri";
import { relaunchApp } from "@/lib/tauri";
import { checkUpdates, installUpdate } from "@/lib/updates-store";
import Updates from "./updates";
const ui = vi.hoisted(() => ({
  phase: "idle" as
    | "idle"
    | "checking"
    | "ready"
    | "downloading"
    | "installing"
    | "installed"
    | "error",
  operationId: 0,
  status: null as UpdateStatus | null,
  progress: null as UpdateProgress | null,
  error: null as unknown,
  autoCheckUpdates: true,
  updatePreferences: vi.fn(),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({
    settings: { autoCheckUpdates: ui.autoCheckUpdates },
    update: ui.updatePreferences,
  }),
}));
vi.mock("@/lib/tauri", () => ({ isTauri: () => true, relaunchApp: vi.fn() }));
vi.mock("@/lib/updates-store", () => ({
  useUpdates: () => ui,
  checkUpdates: vi.fn(),
  installUpdate: vi.fn(),
}));
vi.mock("@/config/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/app")>();
  return {
    APP_CONFIG: {
      ...actual.APP_CONFIG,
      repositoryUrl: "https://github.com/example/migrated-app",
      updates: { ...actual.APP_CONFIG.updates, publicKey: "build-default-key" },
    },
  };
});
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ language: "en", t: createTranslator(en) }) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function deferred<T>() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((_, fail) => {
    reject = fail;
  });
  return { promise, reject };
}
const available: UpdateStatus = {
  operationId: 1,
  configured: true,
  available: true,
  currentVersion: "1.0.0",
  endpoint: "https://updates.example.com/latest.json",
  checkedAt: 1792656000000,
  version: "2.0.0",
  body: "Release notes",
  date: null,
};
describe("updater controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(ui, {
      phase: "idle",
      operationId: 0,
      status: null,
      progress: null,
      error: null,
      autoCheckUpdates: true,
    });
  });
  afterEach(cleanup);
  it("persists the startup preference and shows the effective source and last successful check", () => {
    ui.phase = "ready";
    ui.status = available;
    render(<Updates />);
    fireEvent.click(
      screen.getByRole("switch", { name: "Check for updates on startup" }),
    );
    expect(ui.updatePreferences).toHaveBeenCalledWith({
      autoCheckUpdates: false,
    });
    fireEvent.click(screen.getByText("Release source"));
    expect(
      screen.getByText("https://updates.example.com/latest.json"),
    ).toBeVisible();
    expect(screen.getByText(/Last successful check:/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View GitHub releases" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/example/migrated-app/releases",
    );
  });
  it("distinguishes an unpublished feed from a current version and keeps retry available", () => {
    ui.phase = "error";
    ui.error = { code: "UPDATE_FEED_UNAVAILABLE" };
    render(<Updates />);
    expect(
      screen.getByText(/has not provided an available update manifest/),
    ).toBeVisible();
    expect(
      screen.queryByText("You are using the latest version"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
  it("checks, installs and locks controls while reporting bounded download progress", () => {
    ui.phase = "ready";
    ui.status = available;
    const view = render(<Updates />);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );
    expect(installUpdate).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Download and install",
      }),
    );
    expect(checkUpdates).toHaveBeenCalledOnce();
    expect(installUpdate).toHaveBeenCalledOnce();
    ui.phase = "downloading";
    ui.progress = {
      operationId: 2,
      stage: "downloading",
      downloaded: 150,
      total: 100,
      error: null,
      status: null,
    };
    view.rerender(<Updates />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Download and install" }),
    ).toBeDisabled();
  });
  it("retries a failed operation through a fresh check", () => {
    ui.phase = "error";
    ui.error = { code: "UPDATE_DOWNLOAD_FAILED" };
    render(<Updates />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(checkUpdates).toHaveBeenCalledOnce();
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it("cancels installation without invoking native code and deduplicates confirmation", async () => {
    ui.phase = "ready";
    ui.status = available;
    render(<Updates />);
    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(installUpdate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Download and install",
    });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("invalidates an open installation confirmation when another window checks a newer update", () => {
    ui.phase = "ready";
    ui.status = available;
    const view = render(<Updates />);
    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );
    ui.operationId = 2;
    view.rerender(<Updates />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it("uses the effective native configuration instead of a disabled build-time key", () => {
    ui.phase = "ready";
    ui.status = { ...available, configured: false, available: false };
    render(<Updates />);
    expect(screen.getByText("Signing public key required")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Download and install" }),
    ).not.toBeInTheDocument();
  });
  it("requires restart confirmation, deduplicates relaunch and makes a failed restart retryable", async () => {
    ui.phase = "installed";
    const restart = deferred<void>();
    vi.mocked(relaunchApp).mockReturnValueOnce(restart.promise);
    render(<Updates />);
    fireEvent.click(
      screen.getByRole("button", { name: "Restart application" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(relaunchApp).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Restart application" }),
    );
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Restart application",
    });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(relaunchApp).toHaveBeenCalledOnce();
    await act(async () => restart.reject(new Error("restart failed")));
    expect(confirm).toBeEnabled();
    expect(toast.error).toHaveBeenCalledWith(
      "Operation failed: restart failed",
    );
  });
});

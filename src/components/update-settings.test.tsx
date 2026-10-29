import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { UpdateStatus, UpdateProgress } from "@/lib/tauri";
import { openExternal, relaunchApp } from "@/lib/tauri";
import { checkUpdates, installUpdate } from "@/lib/updates-store";
import { UpdateSettings } from "./update-settings";
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
  native: true,
  language: "en" as "en" | "zh",
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({
    settings: { autoCheckUpdates: ui.autoCheckUpdates },
    update: ui.updatePreferences,
  }),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => ui.native,
  relaunchApp: vi.fn(),
  openExternal: vi.fn(),
}));
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
  const { zhCN } = await import("@/i18n/zh-CN");
  return {
    useI18n: () => ({
      language: ui.language,
      t: createTranslator(ui.language === "en" ? en : zhCN),
    }),
  };
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
      native: true,
      language: "en",
    });
    vi.mocked(openExternal).mockResolvedValue(undefined);
  });
  afterEach(cleanup);
  it("opens release notes as safe Markdown and returns focus after closing", async () => {
    const user = userEvent.setup();
    ui.phase = "ready";
    ui.status = {
      ...available,
      body: [
        "## Added",
        "",
        "- **Faster startup**",
        "- [Full change log](https://github.com/example/app/compare/v1...v2)",
        "- [Unsafe link](javascript:alert(1))",
        "",
        '<script>alert("untrusted")</script>',
        "",
        "![Remote image](https://example.com/tracking.png)",
      ].join("\n"),
    };
    render(<UpdateSettings />);
    const opener = screen.getByRole("button", { name: "Release notes" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Faster startup")).not.toBeInTheDocument();
    await user.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: "Release notes · 2.0.0",
    });
    expect(
      await within(dialog).findByRole("heading", { name: "Added", level: 2 }),
    ).toBeVisible();
    expect(within(dialog).getByRole("list")).toBeVisible();
    expect(within(dialog).getByText("Faster startup").tagName).toBe("STRONG");
    expect(
      within(dialog).queryByRole("link", { name: "Unsafe link" }),
    ).not.toBeInTheDocument();
    expect(dialog.querySelector("script, img")).toBeNull();
    await user.click(
      within(dialog).getByRole("link", { name: "Full change log" }),
    );
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/example/app/compare/v1...v2",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(checkUpdates).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
  });
  it.each([null, "", " \n\t "])(
    "shows a useful release-notes empty state for body %j",
    async (body) => {
      const user = userEvent.setup();
      ui.phase = "ready";
      ui.status = { ...available, body };
      render(<UpdateSettings />);
      await user.click(screen.getByRole("button", { name: "Release notes" }));
      expect(
        within(screen.getByRole("dialog")).getByText(
          "No notes for this version.",
        ),
      ).toBeVisible();
    },
  );
  it("keeps the selected release readable while another check replaces the available version", async () => {
    const user = userEvent.setup();
    ui.phase = "ready";
    ui.status = { ...available, body: "## Selected release" };
    const view = render(<UpdateSettings />);
    await user.click(screen.getByRole("button", { name: "Release notes" }));
    await screen.findByRole("heading", { name: "Selected release" });
    ui.phase = "checking";
    ui.status = null;
    view.rerender(<UpdateSettings />);
    expect(
      screen.getByRole("dialog", { name: "Release notes · 2.0.0" }),
    ).toBeVisible();
    ui.phase = "ready";
    ui.status = { ...available, version: "3.0.0", body: "## Newer release" };
    view.rerender(<UpdateSettings />);
    expect(
      screen.getByRole("heading", { name: "Selected release" }),
    ).toBeVisible();
    expect(screen.queryByText("Newer release")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Release notes" }));
    expect(
      screen.getByRole("dialog", { name: "Release notes · 3.0.0" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Newer release" }),
    ).toBeVisible();
  });
  it("localizes the release-notes dialog and empty state in Chinese", async () => {
    const user = userEvent.setup();
    ui.language = "zh";
    ui.phase = "ready";
    ui.status = { ...available, body: null };
    render(<UpdateSettings />);
    await user.click(screen.getByRole("button", { name: "版本说明" }));
    const dialog = screen.getByRole("dialog", { name: "版本说明 · 2.0.0" });
    expect(within(dialog).getByText("此版本暂无说明。")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeVisible();
  });
  it("persists the startup preference and shows the effective source and last successful check on demand", async () => {
    ui.phase = "ready";
    ui.status = available;
    render(<UpdateSettings />);
    fireEvent.click(
      screen.getByRole("switch", { name: "Check for updates on startup" }),
    );
    expect(ui.updatePreferences).toHaveBeenCalledWith({
      autoCheckUpdates: false,
    });
    expect(
      screen.queryByText("Update verification configured"),
    ).not.toBeInTheDocument();
    const history = screen.getByText("Version history");
    expect(history).not.toBeVisible();
    expect(
      screen.getByText("Update source").closest("details"),
    ).toContainElement(history);
    expect(
      screen.getByText("https://updates.example.com/latest.json"),
    ).not.toBeVisible();
    fireEvent.click(screen.getByText("Update source"));
    expect(
      screen.getByText("https://updates.example.com/latest.json"),
    ).toBeVisible();
    expect(screen.getByText(/Last successful check:/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Version history" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/example/migrated-app/releases",
    );
  });
  it("distinguishes an unpublished feed from a current version and keeps retry available", () => {
    ui.phase = "error";
    ui.error = { code: "UPDATE_FEED_UNAVAILABLE" };
    render(<UpdateSettings />);
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.focus(
      screen.getByRole("region", { name: "Application updates" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/No update information yet/),
      expect.objectContaining({
        action: expect.objectContaining({ label: "Retry" }),
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No update information yet",
    );
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
  it("checks, installs and locks controls while reporting bounded download progress", () => {
    ui.phase = "ready";
    ui.status = available;
    const view = render(<UpdateSettings />);
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
    view.rerender(<UpdateSettings />);
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
    expect(screen.getByRole("status")).toHaveTextContent("Downloading 100%");
    ui.phase = "installing";
    view.rerender(<UpdateSettings />);
    expect(screen.getByRole("status")).toHaveTextContent("Installing…");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download and install" }),
    ).toBeDisabled();
  });
  it("retries a failed operation through a fresh check", () => {
    ui.phase = "error";
    ui.error = { code: "UPDATE_DOWNLOAD_FAILED" };
    render(<UpdateSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Update operation failed",
    );
    expect(checkUpdates).toHaveBeenCalledOnce();
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it("cancels installation without invoking native code and deduplicates confirmation", async () => {
    ui.phase = "ready";
    ui.status = available;
    render(<UpdateSettings />);
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
    const view = render(<UpdateSettings />);
    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );
    ui.operationId = 2;
    view.rerender(<UpdateSettings />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it("uses the effective native configuration instead of a disabled build-time key", () => {
    ui.phase = "ready";
    ui.status = { ...available, configured: false, available: false };
    render(<UpdateSettings />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "In-app updates unavailable",
    );
    expect(
      screen.getByText("Update verification not configured"),
    ).not.toBeVisible();
    fireEvent.click(screen.getByText("Update source"));
    expect(
      screen.getByText("Update verification not configured"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Download and install" }),
    ).not.toBeInTheDocument();
  });
  it("shows the current version before checking and keeps a current result separate from available releases", () => {
    const view = render(<UpdateSettings />);
    expect(
      screen.getByRole("heading", { name: /^Current version:/ }),
    ).toBeVisible();
    expect(checkUpdates).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Version history")).not.toBeVisible();
    fireEvent.click(screen.getByText("Update source"));
    expect(screen.getByRole("link", { name: "Version history" })).toBeVisible();
    expect(
      screen.queryByText(/Last successful check:/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Update source"));
    ui.phase = "ready";
    ui.status = { ...available, available: false, version: null, body: null };
    view.rerender(<UpdateSettings />);
    expect(
      screen.getByRole("heading", { name: "Current version: 1.0.0" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Up to date");
    expect(
      screen.queryByRole("button", { name: "Download and install" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Release notes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Update source"));
    expect(screen.getByRole("link", { name: "Version history" })).toBeVisible();
  });
  it("requires restart confirmation, deduplicates relaunch and makes a failed restart retryable", async () => {
    ui.phase = "installed";
    const restart = deferred<void>();
    vi.mocked(relaunchApp).mockReturnValueOnce(restart.promise);
    render(<UpdateSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Restart app" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(relaunchApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restart app" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Restart app",
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
  it("keeps background failures inline and quiet until the update section is used", () => {
    const view = render(<UpdateSettings />);
    ui.phase = "error";
    ui.error = { code: "UPDATE_FEED_UNAVAILABLE" };
    view.rerender(<UpdateSettings />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No update information yet",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(checkUpdates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(checkUpdates).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledOnce();
  });
  it("shows desktop limits in the browser without invoking update or preference operations", () => {
    ui.native = false;
    ui.phase = "ready";
    ui.status = available;
    render(<UpdateSettings />);
    const check = screen.getByRole("button", { name: "Check for updates" });
    const automatic = screen.getByRole("switch", {
      name: "Check for updates on startup",
    });
    expect(check).toBeDisabled();
    expect(automatic).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "require the desktop app",
    );
    expect(
      screen.queryByRole("button", { name: "Download and install" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Update source"));
    expect(screen.getByRole("link", { name: "Version history" })).toBeVisible();
    fireEvent.click(check);
    fireEvent.click(automatic);
    expect(checkUpdates).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
    expect(relaunchApp).not.toHaveBeenCalled();
    expect(ui.updatePreferences).not.toHaveBeenCalled();
  });
});

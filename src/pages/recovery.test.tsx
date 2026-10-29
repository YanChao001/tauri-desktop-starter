import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { copyText } from "@/lib/clipboard";
import * as native from "@/lib/tauri";
import Recovery from "./recovery";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  recoveryStatus: vi.fn(),
  listRecoveryBackups: vi.fn(),
  pickRecoveryBackup: vi.fn(),
  previewRecoveryBackup: vi.fn(),
  restoreRecoveryBackup: vi.fn(),
  stageRecovery: vi.fn(),
  relaunchApp: vi.fn(),
  getDiagnosticsReport: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const { enRecovery } = await import("@/i18n/en-recovery");
  const { enData } = await import("@/i18n/en-data");
  return {
    useI18n: () => ({
      language: "en",
      t: createTranslator({ ...en, ...enData, ...enRecovery }),
    }),
  };
});

let status: native.RecoveryStatus = {
  active: true,
  reason: "Cannot open original storage",
  restored: false,
  pending: false,
  notes: 0,
  archiveId: null as string | null,
};
function Destination() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>
        {pathname}
        {search}
      </output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
const info = {
  id: "notes-backup-test.json",
  createdAt: "2026-01-01T00:00:00Z",
  notes: 251,
  trashed: 1,
  drafts: 1,
  bytes: 1024,
};
const report: Awaited<ReturnType<typeof native.getDiagnosticsReport>> = {
  appVersion: "1.0.0",
  tauriVersion: "2",
  architecture: "x86_64",
  platform: "windows",
  windowLabel: "main",
  databaseVersion: 1,
  settingsRevision: 4,
  desktop: {
    trayAvailable: true,
    secondaryOpen: false,
    autostartSupported: true,
    runInBackground: false,
  },
  autostartEnabled: false,
  updaterConfigured: false,
  recentLogs: "[local path]",
};

describe("isolated startup recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = {
      active: true,
      reason: "Cannot open original storage",
      restored: false,
      pending: false,
      notes: 0,
      archiveId: null,
    };
    vi.mocked(native.recoveryStatus).mockImplementation(async () => ({
      ...status,
    }));
    vi.mocked(native.listRecoveryBackups).mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("keeps local backup loading distinct from a successfully loaded empty list", async () => {
    let resolve!: (value: native.BackupInfo[]) => void;
    vi.mocked(native.listRecoveryBackups).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<Recovery />);
    const region = await screen.findByRole("region", {
      name: "Local recovery backups",
    });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByRole("status")).toHaveTextContent(
      "Loading local backups…",
    );
    expect(
      within(region).queryByText(/No local backups/),
    ).not.toBeInTheDocument();
    await act(async () => resolve([]));
    expect(region).toHaveAttribute("aria-busy", "false");
    expect(
      within(region).getByText(
        "No local backups were found. Import a previously exported backup file.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Import backup file" }),
    ).toBeEnabled();
  });

  it("keeps backup listing failures inline and retries only the list without changing recovery evidence", async () => {
    status = {
      ...status,
      restored: true,
      notes: 252,
      archiveId: "original-archive",
    };
    vi.mocked(native.listRecoveryBackups)
      .mockRejectedValueOnce({ code: "STORAGE_IO" })
      .mockResolvedValueOnce([info]);
    render(<Recovery />);
    const region = await screen.findByRole("region", {
      name: "Local recovery backups",
    });
    expect(await within(region).findByRole("alert")).toBeVisible();
    expect(
      within(region).queryByText(/No local backups/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Cannot open original storage")).toBeVisible();
    expect(
      screen.getByText("252 records recovered in the trial restore"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Original files from the last recovery: original-archive",
      ),
    ).toBeVisible();
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(within(region).getByRole("button", { name: "Retry" }));
    expect(await within(region).findByText(info.id)).toBeVisible();
    expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
    expect(native.recoveryStatus).toHaveBeenCalledOnce();
    expect(native.restoreRecoveryBackup).not.toHaveBeenCalled();
    expect(native.stageRecovery).not.toHaveBeenCalled();
  });

  it("keeps replacement unavailable until an isolated restore succeeds", async () => {
    render(<Recovery />);
    expect(
      await screen.findByText("Cannot open original storage"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "2. Schedule recovery for next launch",
      }),
    ).toBeDisabled();
    expect(native.stageRecovery).not.toHaveBeenCalled();
    expect(native.restoreRecoveryBackup).not.toHaveBeenCalled();
  });

  it("previews, restores in isolation and schedules replacement only after confirmation", async () => {
    vi.mocked(native.pickRecoveryBackup).mockResolvedValue({
      info,
      schemaVersion: 2,
      sampleTitles: ["Recovered note"],
    });
    vi.mocked(native.restoreRecoveryBackup).mockImplementation(async () => {
      status = { ...status, restored: true, notes: 252 };
      return { ...status };
    });
    vi.mocked(native.stageRecovery).mockImplementation(async () => {
      status = { ...status, pending: true };
      return { ...status };
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import backup file" }),
    );
    expect(await screen.findByText("Recovered note")).toBeVisible();
    expect(native.restoreRecoveryBackup).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Try restoring in a separate space" }),
    );
    await waitFor(() =>
      expect(native.restoreRecoveryBackup).toHaveBeenCalledExactlyOnceWith(
        info.id,
      ),
    );
    const schedule = screen.getByRole("button", {
      name: "2. Schedule recovery for next launch",
    });
    await waitFor(() => expect(schedule).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(schedule);
    expect(native.stageRecovery).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Schedule without restarting",
      }),
    );
    await waitFor(() =>
      expect(native.stageRecovery).toHaveBeenCalledExactlyOnceWith(true),
    );
    expect(
      await screen.findByRole("button", { name: "Restart and apply recovery" }),
    ).toBeVisible();
    expect(native.relaunchApp).not.toHaveBeenCalled();
  });

  it("keeps invalid imports out of the recovery database and preserves the failure message", async () => {
    vi.mocked(native.pickRecoveryBackup).mockRejectedValueOnce({
      code: "STORAGE_CORRUPT",
      message: "Unsupported notes backup format or schema version",
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import backup file" }),
    );
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(
      within(
        screen.getByLabelText("Working in a separate recovery space"),
      ).getByText("Unsupported notes backup format or schema version"),
    ).toBeVisible();
    expect(toast.error).toHaveBeenCalledOnce();
    expect(native.restoreRecoveryBackup).not.toHaveBeenCalled();
    expect(native.stageRecovery).not.toHaveBeenCalled();
  });

  it("reports temporary action failures with a toast and keeps their inline announcement hidden", async () => {
    vi.mocked(native.pickRecoveryBackup).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import backup file" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    const announcements = screen.getAllByRole("alert");
    expect(announcements).toHaveLength(2);
    expect(announcements[1]).toHaveClass("sr-only");
    expect(
      screen.getByRole("button", { name: "Import backup file" }),
    ).toBeEnabled();
  });

  it("keeps recovery evidence readable when an unrelated action fails", async () => {
    status = { ...status, archiveId: "recovery-archive-originals" };
    vi.mocked(native.pickRecoveryBackup).mockRejectedValueOnce({
      code: "STORAGE_CORRUPT",
      message:
        "A newer database must not be downgraded; use the newer application",
    });
    vi.mocked(native.getDiagnosticsReport).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import backup file" }),
    );
    const details = await screen.findByText(
      "A newer database must not be downgraded; use the newer application",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy problem report" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    expect(details).toBeVisible();
    expect(screen.getByText("Cannot open original storage")).toBeVisible();
    expect(
      screen.getByText(
        "Original files from the last recovery: recovery-archive-originals",
      ),
    ).toBeVisible();
  });

  it("copies diagnostics with a success toast and no extra result paragraph", async () => {
    vi.mocked(native.getDiagnosticsReport).mockResolvedValueOnce(report);
    vi.mocked(copyText).mockResolvedValueOnce(undefined);
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy problem report" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Report copied. Check for sensitive information before sharing.",
      ),
    );
    expect(copyText).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
    expect(
      screen.queryByText(
        "Report copied. Check for sensitive information before sharing.",
      ),
    ).not.toBeInTheDocument();
  });

  it("announces scheduling failure inside the confirmation without moving its controls", async () => {
    status = { ...status, restored: true, notes: 252 };
    vi.mocked(native.stageRecovery).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "2. Schedule recovery for next launch",
      }),
    );
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Schedule without restarting",
    });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("alert")).toHaveClass("sr-only");
    expect(confirmButton).toBeEnabled();
    expect(dialog).toHaveAccessibleDescription(
      "Replace your current notes data with the checked recovery data. Original data and related files are saved in the recovery archive first.",
    );
    expect(
      screen.getByText("252 records recovered in the trial restore"),
    ).toBeInTheDocument();
  });

  it("retains retry when the initial recovery status cannot be loaded", async () => {
    vi.mocked(native.recoveryStatus).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Recovery />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(
      await screen.findByText("Cannot open original storage"),
    ).toBeVisible();
  });

  it("keeps existing recovery information when refreshing its status fails", async () => {
    vi.mocked(native.pickRecoveryBackup).mockResolvedValueOnce({
      info,
      schemaVersion: 2,
      sampleTitles: ["Recovered note"],
    });
    vi.mocked(native.restoreRecoveryBackup).mockResolvedValueOnce({
      ...status,
      restored: true,
      notes: 252,
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import backup file" }),
    );
    const restore = await screen.findByRole("button", {
      name: "Try restoring in a separate space",
    });
    vi.mocked(native.recoveryStatus).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    fireEvent.click(restore);
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(screen.getByText("Cannot open original storage")).toBeVisible();
    expect(screen.getByText(info.id)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("does nothing when the file picker is cancelled", async () => {
    vi.mocked(native.pickRecoveryBackup).mockResolvedValueOnce(null);
    render(<Recovery />);
    const picker = await screen.findByRole("button", {
      name: "Import backup file",
    });
    await act(async () => fireEvent.click(picker));
    expect(native.restoreRecoveryBackup).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", {
        name: "Try restoring in a separate space",
      }),
    ).not.toBeInTheDocument();
  });
  it("replaces a healthy legacy recovery link with the combined page while preserving other query parameters", async () => {
    status = { ...status, active: false, reason: null };
    render(
      <MemoryRouter
        initialEntries={["/settings", "/recovery?keep=1&section=old"]}
      >
        <Routes>
          <Route path="/recovery" element={<Recovery />} />
          <Route path="/diagnostics" element={<Destination />} />
          <Route path="/settings" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("/diagnostics?keep=1&section=recovery"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("/settings")).toBeInTheDocument();
    expect(native.listRecoveryBackups).not.toHaveBeenCalled();
  });
});

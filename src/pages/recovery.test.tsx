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
import * as native from "@/lib/tauri";
import Recovery from "./recovery";

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

let status = {
  active: true,
  reason: "Cannot open original storage",
  restored: false,
  pending: false,
  notes: 0,
  archiveId: null as string | null,
};
const info = {
  id: "notes-backup-test.json",
  createdAt: "2026-01-01T00:00:00Z",
  notes: 251,
  trashed: 1,
  drafts: 1,
  bytes: 1024,
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
      screen.getByRole("button", { name: "Test restore in isolation" }),
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
    });
    render(<Recovery />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import backup file" }),
    );
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(native.restoreRecoveryBackup).not.toHaveBeenCalled();
    expect(native.stageRecovery).not.toHaveBeenCalled();
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
      screen.queryByRole("button", { name: "Test restore in isolation" }),
    ).not.toBeInTheDocument();
  });
});

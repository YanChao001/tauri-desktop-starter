import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { RecoveryGate } from "./recovery-gate";
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  recoveryStatus: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en) }) };
});
const healthy: native.RecoveryStatus = {
  active: false,
  reason: null,
  restored: false,
  pending: false,
  notes: 0,
  archiveId: null,
};
function view() {
  return render(
    <MemoryRouter initialEntries={["/database"]}>
      <Routes>
        <Route
          path="/database"
          element={
            <RecoveryGate>
              <p>Business editor</p>
            </RecoveryGate>
          }
        />
        <Route path="/recovery" element={<p>Isolated recovery</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
describe("startup recovery gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it("does not mount a business editor until native storage state is known", async () => {
    let resolve!: (value: native.RecoveryStatus) => void;
    vi.mocked(native.recoveryStatus).mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    view();
    expect(screen.queryByText("Business editor")).not.toBeInTheDocument();
    await act(async () => resolve(healthy));
    expect(await screen.findByText("Business editor")).toBeInTheDocument();
  });
  it("redirects to isolated recovery instead of mounting normal data routes", async () => {
    vi.mocked(native.recoveryStatus).mockResolvedValue({
      ...healthy,
      active: true,
      reason: "Storage corrupt",
    });
    view();
    expect(await screen.findByText("Isolated recovery")).toBeInTheDocument();
    expect(screen.queryByText("Business editor")).not.toBeInTheDocument();
  });
  it("keeps failure visible and permits retry without mounting an unsafe editor", async () => {
    vi.mocked(native.recoveryStatus)
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(healthy);
    view();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText("Business editor")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Business editor")).toBeInTheDocument();
  });
  it("keeps the combined diagnostics recovery destination available during isolation", async () => {
    vi.mocked(native.recoveryStatus).mockResolvedValue({
      ...healthy,
      active: true,
      reason: "Storage corrupt",
    });
    render(
      <MemoryRouter initialEntries={["/diagnostics?section=recovery"]}>
        <RecoveryGate>
          <p>Combined diagnostics and recovery</p>
        </RecoveryGate>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Combined diagnostics and recovery"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Business editor")).not.toBeInTheDocument();
  });
});

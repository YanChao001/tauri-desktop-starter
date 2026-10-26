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
import { copyText } from "@/lib/clipboard";
import { getDiagnosticsReport, type DiagnosticsReport } from "@/lib/tauri";
import Diagnostics from "./diagnostics";

const language = vi.hoisted(() => ({ value: "en" }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  getDiagnosticsReport: vi.fn(),
}));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const { zhCN } = await import("@/i18n/zh-CN");
  return {
    useI18n: () => ({
      language: language.value,
      t: createTranslator(language.value === "en" ? en : zhCN),
    }),
  };
});
const report: DiagnosticsReport = {
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("diagnostics actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    language.value = "en";
    vi.mocked(getDiagnosticsReport).mockResolvedValue(report);
  });
  afterEach(cleanup);
  it("deduplicates copying and reports failures in the currently selected language before retrying", async () => {
    const copy = deferred<void>();
    vi.mocked(copyText).mockReturnValueOnce(copy.promise);
    const view = render(<Diagnostics />);
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-report")).toHaveTextContent(
        '"settingsRevision": 4',
      ),
    );
    const button = screen.getByRole("button", { name: "Copy diagnostics" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify(report, null, 2),
    );
    language.value = "zh";
    view.rerender(<Diagnostics />);
    await act(async () => copy.reject(new Error("clipboard denied")));
    expect(toast.error).toHaveBeenCalledWith("操作失败：clipboard denied");
    expect(toast.success).not.toHaveBeenCalled();
    vi.mocked(copyText).mockResolvedValueOnce();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "复制诊断信息" })),
    );
    expect(toast.success).toHaveBeenCalledWith("诊断信息已复制");
  });
  it("retries a failed diagnostics request before allowing a copy", async () => {
    vi.mocked(getDiagnosticsReport).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    render(<Diagnostics />);
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-report")).toHaveTextContent(
        '"settingsRevision": 4',
      ),
    );
    expect(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeEnabled();
  });
  it("suppresses notifications when a pending copy finishes after navigation", async () => {
    const copy = deferred<void>();
    vi.mocked(copyText).mockReturnValueOnce(copy.promise);
    const view = render(<Diagnostics />);
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-report")).toHaveTextContent(
        '"settingsRevision": 4',
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    view.unmount();
    await act(async () => copy.reject(new Error("closed")));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("preserves the loaded report when a refresh fails and shows its error as a toast", async () => {
    render(<Diagnostics />);
    const preview = await screen.findByTestId("diagnostics-report");
    await waitFor(() =>
      expect(preview).toHaveTextContent('"settingsRevision": 4'),
    );
    vi.mocked(getDiagnosticsReport).mockRejectedValueOnce({
      code: "STORAGE_IO",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh diagnostics" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(preview).toHaveTextContent('"settingsRevision": 4');
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeEnabled();
  });
});

import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { reportClientError } from "@/lib/report-error";
import System from "./system";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  onActivation: vi.fn(),
  getActivationSnapshot: vi.fn(),
  registerGlobalShortcut: vi.fn(),
  openNotesWindow: vi.fn(),
  readSystemClipboard: vi.fn(),
  restoreWorkspace: vi.fn(),
  sendSystemNotification: vi.fn(),
  writeSystemClipboard: vi.fn(),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("@/config/app", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/app")>();
  return {
    ...original,
    APP_CONFIG: {
      ...original.APP_CONFIG,
      name: "Migrated Application",
      integration: { deepLinkScheme: "migrated", fileExtension: "migrate" },
    },
  };
});
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ language: "en", t: createTranslator(en) }) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("system integration lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(native.onActivation).mockResolvedValue(vi.fn());
    vi.mocked(native.getActivationSnapshot).mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("uses the migrated identity for clipboard and activation instructions", async () => {
    render(<System />);
    expect(
      screen.getByDisplayValue("Migrated Application"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("migrated://open?route=/database"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Installed builds support .* and \.migrate files/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(native.getActivationSnapshot).toHaveBeenCalledOnce(),
    );
  });

  it("waits for subscription before loading history and retains newer events", async () => {
    const registration = deferred<() => void>();
    const snapshot = deferred<native.Activation[]>();
    let onActivation!: (value: native.Activation) => void;
    vi.mocked(native.onActivation).mockImplementation((handler) => {
      onActivation = handler;
      return registration.promise;
    });
    vi.mocked(native.getActivationSnapshot).mockReturnValue(snapshot.promise);
    const view = render(<System />);
    expect(native.getActivationSnapshot).not.toHaveBeenCalled();
    const stop = vi.fn();
    await act(async () => registration.resolve(stop));
    expect(native.getActivationSnapshot).toHaveBeenCalledOnce();
    act(() =>
      onActivation({
        id: 2,
        source: "event",
        route: "/tasks",
        files: [],
        resourceIds: [],
        errors: [],
      }),
    );
    await act(async () =>
      snapshot.resolve([
        {
          id: 1,
          source: "startup",
          route: "/settings",
          files: [],
          resourceIds: [],
          errors: [],
        },
        {
          id: 2,
          source: "old",
          route: "/database",
          files: [],
          resourceIds: [],
          errors: [],
        },
      ]),
    );
    expect(screen.getByText(/#1 · startup · \/settings/)).toBeInTheDocument();
    expect(screen.getByText(/#2 · event · \/tasks/)).toBeInTheDocument();
    expect(screen.queryByText(/#2 · old/)).not.toBeInTheDocument();
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("ignores stale callbacks and subscription failures from a StrictMode rebuild", async () => {
    const previous = deferred<() => void>();
    let stale!: (value: native.Activation) => void;
    vi.mocked(native.onActivation).mockImplementationOnce((handler) => {
      stale = handler;
      return previous.promise;
    });
    render(
      <StrictMode>
        <System />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(native.getActivationSnapshot).toHaveBeenCalledOnce(),
    );
    act(() =>
      stale({
        id: 9,
        source: "stale",
        route: "/database",
        files: [],
        resourceIds: [],
        errors: [],
      }),
    );
    await act(async () => previous.reject(new Error("old listener failed")));
    expect(screen.queryByText(/#9 · stale/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("晚到的旧激活不会挤掉较新的历史记录，重复更新保留接收顺序", async () => {
    const activation = (id: number): native.Activation => ({
      id,
      source: "event",
      route: "/tasks",
      files: [],
      resourceIds: [],
      errors: [],
    });
    vi.mocked(native.getActivationSnapshot).mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => activation(index + 2)),
    );
    render(<System />);
    await screen.findByText(/#21 · event/);
    const handler = vi.mocked(native.onActivation).mock.calls[0]![0];
    act(() => handler(activation(1)));
    expect(screen.queryByText(/#1 · event/)).not.toBeInTheDocument();
    expect(screen.getByText(/#2 · event/)).toBeInTheDocument();
    act(() => handler({ ...activation(10), source: "updated" }));
    const rows = screen.getAllByRole("listitem");
    expect(rows[8]).toHaveTextContent("#10 · updated");
    expect(rows.at(-1)).toHaveTextContent("#21 · event");
  });

  it("releases subscriptions that arrive after the page has unmounted", async () => {
    const registration = deferred<() => void>();
    vi.mocked(native.onActivation).mockReturnValue(registration.promise);
    const view = render(<System />);
    view.unmount();
    const stop = vi.fn();
    await act(async () => registration.resolve(stop));
    expect(stop).toHaveBeenCalledOnce();
    expect(native.getActivationSnapshot).not.toHaveBeenCalled();
  });

  it("reports shortcut cleanup failures without an unhandled rejection", async () => {
    const error = new Error("unregister failed");
    const unregister = vi.fn().mockRejectedValue(error);
    vi.mocked(native.registerGlobalShortcut).mockResolvedValue(unregister);
    const view = render(<System />);
    fireEvent.click(screen.getByRole("button", { name: "Register shortcut" }));
    await screen.findByRole("button", { name: "Unregister shortcut" });
    view.unmount();
    await waitFor(() => expect(reportClientError).toHaveBeenCalledWith(error));
  });
});

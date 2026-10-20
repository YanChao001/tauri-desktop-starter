import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import * as native from "@/lib/tauri";
import type { Activation, Workspace } from "@/lib/tauri";
import { useWorkspace } from "./use-workspace";

const router = vi.hoisted(() => ({ navigate: vi.fn(), pathname: "/" }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useLocation: vi.fn(),
  useNavigate: vi.fn(),
}));
vi.mock("@/routes", () => ({
  APP_ROUTES: [
    "/",
    "/database",
    "/tasks",
    "/settings",
    "/workbench",
    "/recovery",
  ].map((path) => ({ path })),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  getCurrentWindowLabel: vi.fn(),
  getWorkspace: vi.fn(),
  getActivationSnapshot: vi.fn(),
  onActivation: vi.fn(),
  onWorkspaceRoute: vi.fn(),
  onSystemNotification: vi.fn(),
  saveWorkspaceRoute: vi.fn(),
  recoveryStatus: vi.fn(),
}));
let activation: ((value: Activation) => void) | undefined;
let route: ((value: string) => void) | undefined;
let notification: (() => void) | undefined;
const stops = [vi.fn(), vi.fn(), vi.fn()];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  router.pathname = "/";
  vi.mocked(useLocation).mockImplementation(
    () => ({ pathname: router.pathname }) as ReturnType<typeof useLocation>,
  );
  vi.mocked(useNavigate).mockImplementation(() => router.navigate);
  activation = undefined;
  route = undefined;
  notification = undefined;
  vi.mocked(native.getCurrentWindowLabel).mockResolvedValue("main");
  vi.mocked(native.getWorkspace).mockResolvedValue({
    routes: {},
    secondaryOpen: false,
  });
  vi.mocked(native.getActivationSnapshot).mockResolvedValue([]);
  vi.mocked(native.recoveryStatus).mockResolvedValue({
    active: false,
    reason: null,
    restored: false,
    pending: false,
    notes: 0,
    archiveId: null,
  });
  vi.mocked(native.saveWorkspaceRoute).mockResolvedValue(undefined);
  vi.mocked(native.onActivation).mockImplementation(async (handler) => {
    activation = handler;
    return stops[0]!;
  });
  vi.mocked(native.onWorkspaceRoute).mockImplementation(async (handler) => {
    route = handler;
    return stops[1]!;
  });
  vi.mocked(native.onSystemNotification).mockImplementation(async (handler) => {
    notification = handler;
    return stops[2]!;
  });
});
afterEach(cleanup);

describe("workspace lifecycle", () => {
  it("ignores callbacks delivered after unmount and releases all listeners", async () => {
    const view = renderHook(useWorkspace);
    await waitFor(() => expect(native.saveWorkspaceRoute).toHaveBeenCalled());
    router.navigate.mockClear();
    view.unmount();
    act(() => {
      activation?.({
        id: 9,
        source: "single-instance",
        route: "/workbench",
        files: [],
      });
      route?.("/database");
      notification?.();
    });
    expect(router.navigate).not.toHaveBeenCalled();
    stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
  });

  it("keeps a newer activation when an older initialization snapshot resolves later", async () => {
    const initial = deferred<Workspace>();
    vi.mocked(native.getWorkspace).mockReturnValue(initial.promise);
    vi.mocked(native.getActivationSnapshot).mockResolvedValue([
      { id: 1, source: "startup", route: "/settings", files: [] },
    ]);
    renderHook(useWorkspace);
    await waitFor(() => expect(native.getWorkspace).toHaveBeenCalled());
    act(() =>
      activation?.({ id: 2, source: "deep-link", route: "/tasks", files: [] }),
    );
    expect(router.navigate).toHaveBeenLastCalledWith("/tasks");
    await act(async () =>
      initial.resolve({ routes: { main: "/database" }, secondaryOpen: false }),
    );
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it("keeps a workspace route event ahead of a stale restore snapshot", async () => {
    const initial = deferred<Workspace>();
    vi.mocked(native.getWorkspace).mockReturnValue(initial.promise);
    renderHook(useWorkspace);
    await waitFor(() => expect(native.getWorkspace).toHaveBeenCalled());
    act(() => route?.("/workbench"));
    await act(async () =>
      initial.resolve({ routes: { main: "/database" }, secondaryOpen: false }),
    );
    expect(router.navigate).toHaveBeenCalledExactlyOnceWith("/workbench");
  });

  it("keeps an activation delivered during subscription ahead of the initialization snapshot", async () => {
    vi.mocked(native.onActivation).mockImplementation(async (handler) => {
      handler({ id: 2, source: "deep-link", route: "/tasks", files: [] });
      return stops[0]!;
    });
    vi.mocked(native.getActivationSnapshot).mockResolvedValue([
      { id: 1, source: "startup", route: "/settings", files: [] },
    ]);
    renderHook(useWorkspace);
    await waitFor(() => expect(native.getWorkspace).toHaveBeenCalled());
    await act(async () => {});
    expect(router.navigate).toHaveBeenCalledExactlyOnceWith("/tasks");
  });

  it("keeps manual navigation, including returning to the initial route, ahead of a delayed snapshot", async () => {
    const initial = deferred<Workspace>();
    vi.mocked(native.getWorkspace).mockReturnValue(initial.promise);
    const view = renderHook(useWorkspace);
    await waitFor(() => expect(native.getWorkspace).toHaveBeenCalledOnce());
    router.pathname = "/tasks";
    view.rerender();
    router.pathname = "/";
    view.rerender();
    await act(async () =>
      initial.resolve({ routes: { main: "/database" }, secondaryOpen: false }),
    );
    expect(router.navigate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenLastCalledWith("/"),
    );
    expect(native.getWorkspace).toHaveBeenCalledOnce();
  });

  it("uses the current router navigator without repeating initialization or restoring over manual routes", async () => {
    const actual =
      await vi.importActual<typeof import("react-router-dom")>(
        "react-router-dom",
      );
    vi.mocked(useLocation).mockImplementation(actual.useLocation);
    vi.mocked(useNavigate).mockImplementation(actual.useNavigate);
    const initial = deferred<Workspace>();
    vi.mocked(native.getWorkspace).mockReturnValue(initial.promise);
    const view = renderHook(
      () => {
        useWorkspace();
        return { location: useLocation(), navigate: useNavigate() };
      },
      {
        wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    );
    await waitFor(() => expect(native.getWorkspace).toHaveBeenCalledOnce());
    act(() => {
      void view.result.current.navigate("/tasks");
    });
    expect(view.result.current.location.pathname).toBe("/tasks");
    await act(async () =>
      initial.resolve({ routes: { main: "/database" }, secondaryOpen: false }),
    );
    expect(view.result.current.location.pathname).toBe("/tasks");
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenLastCalledWith("/tasks"),
    );
    act(() => route?.("/workbench"));
    expect(view.result.current.location.pathname).toBe("/workbench");
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenLastCalledWith("/workbench"),
    );
    expect(native.getWorkspace).toHaveBeenCalledOnce();
    expect(native.onActivation).toHaveBeenCalledOnce();
    expect(native.onWorkspaceRoute).toHaveBeenCalledOnce();
  });

  it("restores a cold-start activation missed before the frontend subscribed", async () => {
    vi.mocked(native.getActivationSnapshot).mockResolvedValue([
      {
        id: 1,
        source: "startup",
        route: "/workbench",
        files: ["example.tdemo"],
      },
    ]);
    renderHook(useWorkspace);
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith("/workbench"),
    );
  });

  it("restores a cold activation in the real router before saving the initialized route", async () => {
    const actual =
      await vi.importActual<typeof import("react-router-dom")>(
        "react-router-dom",
      );
    vi.mocked(useLocation).mockImplementation(actual.useLocation);
    vi.mocked(useNavigate).mockImplementation(actual.useNavigate);
    vi.mocked(native.getWorkspace).mockResolvedValue({
      routes: { main: "/database" },
      secondaryOpen: false,
    });
    vi.mocked(native.getActivationSnapshot).mockResolvedValue([
      {
        id: 1,
        source: "startup",
        route: "/workbench",
        files: ["sample.tdemo"],
      },
    ]);
    const view = renderHook(
      () => {
        useWorkspace();
        return useLocation();
      },
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    );
    await waitFor(() =>
      expect(view.result.current.pathname).toBe("/workbench"),
    );
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenCalledExactlyOnceWith(
        "/workbench",
      ),
    );
    expect(native.getWorkspace).toHaveBeenCalledOnce();
  });

  it("does not treat a StrictMode subscription rebuild as permission to replace a newer activation", async () => {
    const actual =
      await vi.importActual<typeof import("react-router-dom")>(
        "react-router-dom",
      );
    vi.mocked(useLocation).mockImplementation(actual.useLocation);
    vi.mocked(useNavigate).mockImplementation(actual.useNavigate);
    const initial = deferred<Workspace>();
    vi.mocked(native.getWorkspace).mockReturnValue(initial.promise);
    vi.mocked(native.onActivation).mockImplementationOnce(async (handler) => {
      handler({ id: 2, source: "deep-link", route: "/tasks", files: [] });
      return stops[0]!;
    });
    const view = renderHook(
      () => {
        useWorkspace();
        return useLocation();
      },
      {
        wrapper: ({ children }) => (
          <MemoryRouter>
            <StrictMode>{children}</StrictMode>
          </MemoryRouter>
        ),
      },
    );
    await waitFor(() => expect(view.result.current.pathname).toBe("/tasks"));
    await act(async () =>
      initial.resolve({ routes: { main: "/database" }, secondaryOpen: false }),
    );
    expect(view.result.current.pathname).toBe("/tasks");
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenLastCalledWith("/tasks"),
    );
  });

  it("serializes route writes so an older asynchronous save cannot overwrite a newer route", async () => {
    const writing = deferred<void>();
    vi.mocked(native.saveWorkspaceRoute).mockReturnValueOnce(writing.promise);
    const view = renderHook(useWorkspace);
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenCalledWith("/"),
    );
    router.pathname = "/tasks";
    view.rerender();
    await act(async () => {});
    expect(native.saveWorkspaceRoute).toHaveBeenCalledTimes(1);
    await act(async () => writing.resolve());
    await waitFor(() =>
      expect(native.saveWorkspaceRoute).toHaveBeenLastCalledWith("/tasks"),
    );
  });

  it("opens recovery without persisting the temporary workspace over the healthy workspace", async () => {
    vi.mocked(native.recoveryStatus).mockResolvedValue({
      active: true,
      reason: "corrupt",
      restored: false,
      pending: false,
      notes: 0,
      archiveId: null,
    });
    vi.mocked(native.getWorkspace).mockResolvedValue({
      routes: { main: "/database" },
      secondaryOpen: true,
    });
    const view = renderHook(useWorkspace);
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith("/recovery"),
    );
    router.pathname = "/recovery";
    view.rerender();
    await act(async () => {});
    expect(native.saveWorkspaceRoute).not.toHaveBeenCalled();
  });

  it("calls a listener disposer that resolves only after unmount", async () => {
    const registration = deferred<() => void>();
    vi.mocked(native.onActivation).mockReturnValue(registration.promise);
    const view = renderHook(useWorkspace);
    view.unmount();
    const stop = vi.fn();
    await act(async () => registration.resolve(stop));
    expect(stop).toHaveBeenCalledOnce();
  });
});

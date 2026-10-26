import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { THEME_REVEAL_EVENT } from "@/hooks/use-theme-switch";
import { ExtensionCustomUi } from "./extension-custom-ui";

const environment = vi.hoisted(() => ({ language: "en" as "en" | "zh" }));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: environment.language }),
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { motion: "full" } }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  openExtensionUi: vi.fn(),
  closeExtensionUi: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("font-size");
  document.documentElement.removeAttribute("data-font-size");
  environment.language = "en";
});

it("limits missing paint acknowledgements only after a visible first view, resetting for background and offscreen pauses", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        postMessage() {},
        start() {},
        close() {},
        onmessage: null,
        onmessageerror: null,
      };
      port2 = {};
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let intersect: (() => void) | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: () => void) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  let top = 0;
  vi.spyOn(
    HTMLIFrameElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => ({
    x: 0,
    y: top,
    left: 0,
    top,
    right: 640,
    bottom: top + 400,
    width: 640,
    height: 400,
    toJSON() {},
  }));
  vi.mocked(native.openExtensionUi).mockResolvedValue({
    url: "about:blank",
    token: "paint-watchdog",
  });
  vi.mocked(native.closeExtensionUi).mockResolvedValue(undefined);
  const props = {
    item,
    commandId: "open",
    view: null,
    fields: {},
    checkpoint: null,
    busy: false,
    dirty: false,
    execute: vi.fn(),
  };
  const result = render(<ExtensionCustomUi {...props} />);
  await act(async () => {});
  const frame = result.container.querySelector("iframe")!;
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "starter:ready", version: 1 },
      }),
    ),
  );
  act(() => vi.advanceTimersByTime(60000));
  expect(result.queryByRole("alert")).toBeNull(); // Slow Wasm has no UI paint budget yet.
  const view: native.ExtensionView = {
    version: 2,
    state: "{}",
    display: "Ready",
    description: "",
    fields: [],
    groups: [],
  };
  result.rerender(<ExtensionCustomUi {...props} view={view} />);
  act(() => vi.advanceTimersByTime(14000));
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(60000));
  expect(result.queryByRole("alert")).toBeNull();
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(14000));
  top = window.innerHeight + 100;
  act(() => intersect?.());
  act(() => vi.advanceTimersByTime(60000));
  expect(result.queryByRole("alert")).toBeNull();
  top = 0;
  act(() => intersect?.());
  act(() => vi.advanceTimersByTime(14000));
  // Field edits and busy changes must not restart the remaining paint budget.
  result.rerender(
    <ExtensionCustomUi
      {...props}
      view={view}
      fields={{ draft: "kept" }}
      busy
    />,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(result.getByRole("alert")).toBeTruthy();
  result.rerender(<ExtensionCustomUi {...props} view={view} />);
  const beforeRetry = vi.mocked(native.openExtensionUi).mock.calls.length;
  await act(async () =>
    fireEvent.click(result.getByRole("button", { name: "common.retry" })),
  );
  expect(native.openExtensionUi).toHaveBeenCalledTimes(beforeRetry + 1);
  expect(result.queryByRole("alert")).toBeNull();
  const retriedFrame = result.container.querySelector("iframe")!;
  vi.spyOn(retriedFrame.contentWindow!, "postMessage").mockImplementation(
    () => {},
  );
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: retriedFrame.contentWindow,
        origin: "null",
        data: { type: "starter:ready", version: 1 },
      }),
    ),
  );
  act(() => vi.advanceTimersByTime(14000));
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: retriedFrame.contentWindow,
        origin: "null",
        data: { type: "starter:painted", version: 1 },
      }),
    ),
  );
  act(() => vi.advanceTimersByTime(60000));
  expect(result.queryByRole("alert")).toBeNull();
  expect(retriedFrame.style.opacity).toBe("1");
});

const item: native.ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: [],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.4",
      id: "test.surface",
      version: "1.0.0",
      name: "Surface",
      author: "Test",
      description: "Fixture",
      permissions: [],
      optionalPermissions: ["storage"],
      network: [],
      commands: [
        {
          id: "open",
          title: "Open",
          function: "open",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
          ui: { sidebar: true, window: true, document: "main" },
        },
      ],
    },
  },
};

it("updates environment and drafts without rereading the palette or reloading the frame for field edits and optional grants", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        postMessage: (value: unknown) => sent.push(value),
        start() {},
        close() {},
        onmessage: null,
        onmessageerror: null,
      };
      port2 = {};
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(native.openExtensionUi).mockResolvedValue({
    url: "about:blank",
    token: "fixture-token",
  });
  vi.mocked(native.closeExtensionUi).mockResolvedValue(undefined);
  document.documentElement.style.fontSize = "17px";
  const styles = vi.spyOn(window, "getComputedStyle");
  const execute = vi.fn().mockResolvedValue(null);
  const props = {
    item,
    commandId: "open",
    view: null,
    fields: { text: "draft" },
    checkpoint: null,
    busy: false,
    dirty: true,
    execute,
  };
  const { container, rerender } = render(<ExtensionCustomUi {...props} />);
  await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  const frame = container.querySelector("iframe")!;
  expect(frame.style.opacity).toBe("0");
  expect(frame.getAttribute("aria-hidden")).toBe("true");
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "starter:ready", version: 1 },
      }),
    );
  });
  // A channel handshake alone must not expose an unthemed or empty document.
  expect(frame.style.opacity).toBe("0");
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "starter:painted", version: 1 },
      }),
    ),
  );
  expect(frame.style.opacity).toBe("0");
  const paletteReads = () =>
    styles.mock.calls.filter(([target]) => target === document.documentElement)
      .length;
  const before = paletteReads();
  const state = () =>
    sent
      .filter(
        (
          value,
        ): value is {
          type: "state";
          value: {
            locale: string;
            fields: Record<string, string>;
            theme: { mode: string; tokens: Record<string, string> };
            grantedPermissions: string[];
          };
        } =>
          typeof value === "object" &&
          value !== null &&
          "type" in value &&
          value.type === "state",
      )
      .at(-1)!.value;
  rerender(
    <ExtensionCustomUi
      {...props}
      fields={{ text: "edited" }}
      item={{ ...item, grantedPermissions: ["storage"] }}
    />,
  );
  await waitFor(() => expect(state().fields.text).toBe("edited"));
  expect(state().grantedPermissions).toEqual(["storage"]);
  expect(paletteReads()).toBe(before);
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
  environment.language = "zh";
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.fontSize = "sm";
  document.documentElement.style.fontSize = "14px";
  rerender(<ExtensionCustomUi {...props} fields={{ text: "edited" }} />);
  await waitFor(() => expect(state().theme.mode).toBe("dark"));
  expect(state().locale).toBe("zh-CN");
  expect(state().fields.text).toBe("edited");
  expect(state().theme.tokens["--host-font-size"]).toBe("14px");
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    left: 40,
    top: 80,
  } as DOMRect);
  act(() =>
    window.dispatchEvent(
      new CustomEvent(THEME_REVEAL_EVENT, {
        detail: {
          id: 1,
          clientX: 100,
          clientY: 200,
          radius: 1200,
          duration: 520,
          startedAt: 1,
          easing: "ease-in-out",
        },
      }),
    ),
  );
  expect(sent).toContainEqual({
    type: "theme-transition",
    value: {
      id: 1,
      clientX: 100,
      clientY: 200,
      x: 60,
      y: 120,
      radius: 1200,
      duration: 520,
      startedAt: 1,
      easing: "ease-in-out",
    },
  });
  const view: native.ExtensionView = {
    version: 2,
    state: "{}",
    display: "Ready",
    description: "",
    fields: [],
    groups: [],
  };
  rerender(<ExtensionCustomUi {...props} view={view} />);
  expect(frame.style.opacity).toBe("0");
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "starter:painted", version: 1 },
      }),
    ),
  );
  expect(frame.style.opacity).toBe("1");
  expect(frame.getAttribute("aria-hidden")).toBe("false");
  rerender(<ExtensionCustomUi {...props} view={view} busy />);
  expect(frame.style.opacity).toBe("1");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

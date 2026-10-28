import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { THEME_REVEAL_EVENT } from "@/hooks/use-theme-switch";
import { ExtensionCustomUi } from "./extension-custom-ui";
import { ExtensionActivityProvider } from "./extension-activity";

const environment = vi.hoisted(() => ({
  language: "en" as "en" | "zh",
  inputWide: true,
  inputListeners: new Set<() => void>(),
}));
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
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: environment.inputWide,
      addEventListener: (_type: string, listener: () => void) =>
        environment.inputListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        environment.inputListeners.delete(listener),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("font-size");
  document.documentElement.removeAttribute("data-font-size");
  environment.language = "en";
  environment.inputWide = true;
  environment.inputListeners.clear();
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

it("keeps one shared page placeholder through lease, first-view and SDK-paint waits", async () => {
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
  let leaseReady!: (lease: { url: string; token: string }) => void;
  vi.mocked(native.openExtensionUi).mockReturnValueOnce(
    new Promise((resolve) => {
      leaseReady = resolve;
    }),
  );
  const props = {
    item,
    commandId: "open",
    view: null,
    fields: {},
    checkpoint: null,
    busy: true,
    dirty: false,
    execute: vi.fn(),
  };
  const result = render(<ExtensionCustomUi {...props} />);
  const loading = result.getByRole("status", { name: "common.loading" });
  expect(loading).toBeVisible();
  expect(loading).toHaveAttribute("data-page-loading");
  expect(result.container.querySelector("iframe")).toBeNull();
  await act(async () =>
    leaseReady({ url: "about:blank", token: "loading-stages" }),
  );
  const frame = result.container.querySelector("iframe")!;
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  const notify = (type: "starter:ready" | "starter:painted") =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "null",
          data: { type, version: 1 },
        }),
      ),
    );
  notify("starter:ready");
  notify("starter:painted");
  // 没有首个业务视图时，提前到达的绘制通知不能暴露空白内容框。
  expect(result.getByRole("status", { name: "common.loading" })).toBe(loading);
  expect(frame.style.opacity).toBe("0");
  const view: native.ExtensionView = {
    version: 2,
    state: "{}",
    display: "Ready",
    description: "",
    fields: [],
    groups: [],
  };
  result.rerender(<ExtensionCustomUi {...props} view={view} busy={false} />);
  expect(result.getByRole("status", { name: "common.loading" })).toBe(loading);
  expect(frame).toHaveAttribute("aria-hidden", "true");
  expect(frame).toHaveAttribute("tabindex", "-1");
  notify("starter:painted");
  expect(result.queryByRole("status", { name: "common.loading" })).toBeNull();
  expect(frame.style.opacity).toBe("1");
  expect(frame).toHaveAttribute("aria-hidden", "false");
  expect(frame).not.toHaveAttribute("tabindex");
});

it("retains the same isolated document across activity changes and gives a resumed document a fresh initialization budget", async () => {
  vi.useFakeTimers();
  const sent: unknown[] = [];
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        postMessage: (message: unknown) => sent.push(message),
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
  vi.spyOn(
    HTMLIFrameElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({ top: 0, left: 0, right: 640, bottom: 400 } as DOMRect);
  vi.mocked(native.openExtensionUi).mockResolvedValue({
    url: "about:blank",
    token: "retained-document",
  });
  vi.mocked(native.closeExtensionUi).mockResolvedValue(undefined);
  const content = (active: boolean) => (
    <ExtensionActivityProvider active={active}>
      <ExtensionCustomUi
        item={item}
        commandId="open"
        view={{
          version: 2,
          state: "{}",
          display: "Ready",
          description: "",
          fields: [],
          groups: [],
        }}
        fields={{}}
        checkpoint={null}
        busy={false}
        dirty={false}
        execute={vi.fn()}
      />
    </ExtensionActivityProvider>
  );
  const mounted = render(content(true));
  await act(async () => {});
  const frame = mounted.container.querySelector("iframe")!;
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  act(() => vi.advanceTimersByTime(9000));
  mounted.rerender(content(false));
  act(() => vi.advanceTimersByTime(60000));
  expect(mounted.queryByRole("alert")).toBeNull();
  mounted.rerender(content(true));
  act(() => vi.advanceTimersByTime(9000));
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "starter:ready", version: 1 },
      }),
    ),
  );
  await act(async () => {});
  mounted.rerender(content(false));
  await act(async () => {});
  expect(sent).toContainEqual(
    expect.objectContaining({
      type: "state",
      value: expect.objectContaining({ active: false }),
    }),
  );
  act(() => vi.advanceTimersByTime(60000));
  mounted.rerender(content(true));
  await act(async () => {});
  expect(sent).toContainEqual(
    expect.objectContaining({
      type: "state",
      value: expect.objectContaining({ active: true }),
    }),
  );
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: { type: "starter:painted", version: 1 },
      }),
    ),
  );
  expect(mounted.container.querySelector("iframe")).toBe(frame);
  expect(frame.style.opacity).toBe("1");
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
  expect(native.closeExtensionUi).not.toHaveBeenCalled();
});

it.each([
  { name: "standalone large text", top: 80, trailing: 30, height: 710 },
  { name: "embedded page", top: 70, trailing: 50, height: 560 },
  { name: "short viewport", top: 80, trailing: 30, height: 180 },
])(
  "fits the frame inside the $name region using actual trailing content and padding",
  async ({ top, trailing, height }) => {
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.mocked(native.openExtensionUi).mockResolvedValue({
      url: "about:blank",
      token: "layout",
    });
    vi.mocked(native.closeExtensionUi).mockResolvedValue(undefined);
    const result = render(
      <main className="app-main">
        <div data-testid="content">
          <ExtensionCustomUi
            item={item}
            commandId="open"
            view={null}
            fields={{}}
            checkpoint={null}
            busy={false}
            dirty={false}
            execute={vi.fn()}
          />
        </div>
      </main>,
    );
    const region = result.getByRole("main");
    const content = result.getByTestId("content");
    region.scrollTop = 17;
    Object.defineProperty(region, "clientHeight", { get: () => height });
    const rectangle = (y: number, size: number): DOMRect => ({
      x: 0,
      y,
      left: 0,
      top: y,
      right: 640,
      bottom: y + size,
      width: 640,
      height: size,
      toJSON() {},
    });
    vi.spyOn(region, "getBoundingClientRect").mockImplementation(() =>
      rectangle(50, height),
    );
    const frameHeight = () =>
      parseFloat(
        result.container.querySelector("iframe")?.style.height ?? "",
      ) || 150;
    vi.spyOn(content, "getBoundingClientRect").mockImplementation(() =>
      rectangle(top - region.scrollTop, frameHeight() + trailing),
    );
    vi.spyOn(
      HTMLIFrameElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(() =>
      rectangle(top - region.scrollTop, frameHeight()),
    );
    await waitFor(() => {
      const frame = result.container.querySelector("iframe");
      expect(frame?.style.height).toBe(`${50 + height - top - trailing}px`);
      expect(frame?.parentElement).not.toHaveClass("min-h-64");
    });
    // 再次缩小窗口时继续使用内容框内滚动，不以固定最小高度撑出外层滚动。
    height -= 100;
    act(() => resize?.());
    await waitFor(() =>
      expect(result.container.querySelector("iframe")?.style.height).toBe(
        `${Math.max(1, 50 + height - top - trailing)}px`,
      ),
    );
  },
);

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
  const glassTokens: Record<string, string> = {
    "--control-background": "rgba(0, 0, 0, 0.89)",
    "--surface-popover": "rgba(0, 0, 0, 0.89)",
    "--surface-dialog": "rgba(0, 0, 0, 0.93)",
    "--surface-control-blur": "6px",
    "--surface-popup-blur": "9px",
  };
  const readProperty = CSSStyleDeclaration.prototype.getPropertyValue;
  vi.spyOn(
    CSSStyleDeclaration.prototype,
    "getPropertyValue",
  ).mockImplementation(function (this: CSSStyleDeclaration, property: string) {
    if (property === "--control-input-font-size")
      return environment.inputWide ? "0.875rem" : "1rem";
    if (property === "--control-input-line-height")
      return environment.inputWide ? "1.25rem" : "1.5rem";
    const glassValue = glassTokens[property];
    if (glassValue !== undefined) return glassValue;
    return readProperty.call(this, property);
  });
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
  const { container, rerender, unmount } = render(
    <ExtensionCustomUi {...props} />,
  );
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
      .map((message) => message.value)
      .reduce((previous, patch) => ({ ...previous, ...patch }));
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
  expect(state().theme.tokens["--control-input-font-size"]).toBe("0.875rem");
  expect(state().theme.tokens).toMatchObject(glassTokens);
  const priorResize = paletteReads();
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(paletteReads()).toBe(priorResize);
  act(() => {
    environment.inputWide = false;
    for (const listener of environment.inputListeners) listener();
  });
  await waitFor(() =>
    expect(state().theme.tokens["--control-input-font-size"]).toBe("1rem"),
  );
  expect(state().theme.tokens["--control-input-line-height"]).toBe("1.5rem");
  expect(native.openExtensionUi).toHaveBeenCalledOnce();
  act(() => {
    environment.inputWide = true;
    for (const listener of environment.inputListeners) listener();
  });
  await waitFor(() =>
    expect(state().theme.tokens["--control-input-font-size"]).toBe("0.875rem"),
  );
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
  unmount();
  expect(environment.inputListeners.size).toBe(0);
});

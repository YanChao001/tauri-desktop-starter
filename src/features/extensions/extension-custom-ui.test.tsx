import { act, cleanup, render, waitFor } from "@testing-library/react";
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
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("font-size");
  document.documentElement.removeAttribute("data-font-size");
  environment.language = "en";
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
});

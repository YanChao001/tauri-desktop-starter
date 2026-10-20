import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@/hooks/use-external-links", () => ({ useExternalLinks: vi.fn() }));
vi.mock("@/hooks/use-reveal-window", () => ({ useRevealWindow: vi.fn() }));
vi.mock("@/providers/commands", () => ({
  CommandsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/desktop-effects", () => ({ DesktopEffects: () => null }));
vi.mock("@/providers/unsaved-work", () => ({
  UnsavedWorkProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/recovery-gate", () => ({
  RecoveryGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/demo-motion", () => ({
  DemoMotion: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/layouts/app-shell", () => ({
  AppShell: () => <Outlet />,
}));
vi.mock("@/routes", () => ({
  APP_ROUTES: [{ path: "/", index: true, component: () => <p>Home page</p> }],
}));
vi.mock("@/providers/settings", () => ({
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/providers/i18n", () => ({
  I18nProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

describe("应用路由", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("未知 hash 路径返回可用首页并替换无效地址", async () => {
    window.history.replaceState(null, "", "/#/missing/deep-link");
    render(<App />);
    expect(await screen.findByText("Home page")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/"));
  });
});

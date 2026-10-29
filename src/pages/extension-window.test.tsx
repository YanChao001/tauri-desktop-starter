import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import ExtensionWindow from "./extension-window";

const state = vi.hoisted(() => ({
  broken: true,
  execute: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/providers/commands", () => ({
  useCommands: () => ({ execute: state.execute }),
}));
vi.mock("@/features/extensions/extensions-provider", () => ({
  useExtensions: () => ({ data: null }),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
vi.mock("@/components/title-bar", () => ({
  TitleBar: () => <header>Window controls</header>,
}));
vi.mock("@/components/window-background", () => ({
  WindowBackground: () => null,
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("./extension-app", () => ({
  ExtensionPage: () => {
    if (state.broken) throw new Error("Broken extension view");
    return <p>Recovered application</p>;
  },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("preserves native window controls after a view failure and offers close and retry", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={["/extension-window/example.lab/open"]}>
      <ExtensionWindow />
    </MemoryRouter>,
  );
  const titleBar = screen.getByRole("banner");
  expect(screen.getByRole("main")).toHaveAttribute("tabindex", "0");
  expect(titleBar).toHaveTextContent("Window controls");
  expect(screen.getByRole("alert")).toHaveTextContent("Broken extension view");
  expect(
    screen.queryByRole("button", { name: "Back home" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(state.execute).toHaveBeenCalledWith("close-window");
  state.broken = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByText("Recovered application")).toBeVisible();
  expect(screen.getByRole("banner")).toBe(titleBar);
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CommandPalette } from "./command-palette";

const state = vi.hoisted(() => ({
  open: true,
  failed: false,
  native: true,
  loading: false,
  tooLong: false,
  retry: vi.fn(),
  setOpen: vi.fn(),
}));
vi.mock("@/providers/commands", () => ({
  useCommands: () => ({
    commands: [],
    execute: vi.fn(),
    paletteOpen: state.open,
    setPaletteOpen: state.setOpen,
  }),
}));
vi.mock("@/features/content-search/use-content-search", () => ({
  useContentSearch: () => ({
    failed: state.failed,
    native: state.native,
    loading: state.loading,
    tooLong: state.tooLong,
    ids: new Set(),
    retry: state.retry,
  }),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ t, language: "en" }) };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    open: true,
    failed: false,
    native: true,
    loading: false,
    tooLong: false,
  });
});
afterEach(cleanup);

it("announces each search failure once with a retry that retains the failed query", async () => {
  const mounted = render(<CommandPalette />);
  const input = screen.getByRole("combobox", { name: "Quick actions" });
  fireEvent.change(input, { target: { value: "report" } });
  state.failed = true;
  mounted.rerender(<CommandPalette />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  mounted.rerender(<CommandPalette />);
  expect(toast.error).toHaveBeenCalledOnce();
  const action = vi.mocked(toast.error).mock.calls[0]?.[1]?.action as {
    label: string;
    onClick: () => void;
  };
  expect(action.label).toBe("Retry");
  act(() => action.onClick());
  expect(state.retry).toHaveBeenCalledOnce();
  expect(state.setOpen).toHaveBeenCalledWith(true);
  expect(input).toHaveValue("report");
  state.failed = false;
  mounted.rerender(<CommandPalette />);
  state.failed = true;
  mounted.rerender(<CommandPalette />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
});

it.each([true, false])(
  "shows the correct native=%s search explanation on keyboard focus without a permanent hint row",
  async (native) => {
    state.native = native;
    render(<CommandPalette />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.focus(
      screen.getByRole("button", { name: "Help for Quick actions" }),
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      native ? "Type at least 2 characters" : "Search commands in a browser",
    );
  },
);

it("uses one live status slot for loading and query limits", () => {
  const mounted = render(<CommandPalette />);
  const status = screen.getByRole("status");
  state.loading = true;
  mounted.rerender(<CommandPalette />);
  expect(status).toHaveTextContent("Searching local content…");
  state.tooLong = true;
  mounted.rerender(<CommandPalette />);
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toHaveTextContent(
    "Content search allows up to 200 UTF-8 bytes",
  );
});

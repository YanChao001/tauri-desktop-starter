import { useCallback, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { AppCommand } from "@/commands/types";
import * as native from "@/lib/tauri";
import { CommandsContext } from "@/providers/commands-context";
import { CommandPalette } from "./command-palette";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  queryNotes: vi.fn(),
  recentWorkbenchFiles: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ t, language: "en" }) };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function Palette() {
  const [commands, setCommands] = useState<AppCommand[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const register = useCallback((items: readonly AppCommand[]) => {
    setCommands([...items]);
    return () => setCommands([]);
  }, []);
  return (
    <MemoryRouter>
      <CommandsContext.Provider
        value={{
          commands,
          register,
          paletteOpen,
          setPaletteOpen,
          execute: async (id) => {
            await commands.find((command) => command.id === id)?.run();
            return true;
          },
          aboutOpen: false,
          setAboutOpen: () => {},
          fullscreen: false,
        }}
      >
        <CommandPalette />
      </CommandsContext.Provider>
    </MemoryRouter>
  );
}

const notes = (title: string) => ({
  items: [{ id: 2, title, body: "", version: 1, updatedAt: "" }],
  total: 1,
  limit: 8,
  offset: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.queryNotes).mockReset();
  vi.mocked(native.recentWorkbenchFiles).mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

it("keeps a failed search recoverable in the status slot after its notification", async () => {
  vi.mocked(native.queryNotes)
    .mockRejectedValueOnce({ code: "STORAGE_IO" })
    .mockResolvedValueOnce(notes("report recovered"));
  const user = userEvent.setup();
  render(<Palette />);
  const input = screen.getByRole("combobox", { name: "Quick actions" });
  const status = screen.getByRole("status");
  await user.type(input, "report");
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(status).toHaveTextContent("Some content searches failed");
  expect(screen.queryByText("No matching actions")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const retry = within(status).getByRole("button", { name: "Retry" });
  await user.tab();
  expect(retry).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(input).toHaveFocus();
  expect(input).toHaveValue("report");
  expect(status).toHaveTextContent("Searching local content…");
  expect(
    await screen.findByRole("option", { name: /report recovered/ }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toBeEmptyDOMElement();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
});

it.each(["pointer", "keyboard"])(
  "keeps partial results usable and lets %s retry without selecting a result",
  async (interaction) => {
    vi.mocked(native.queryNotes)
      .mockRejectedValueOnce({ code: "STORAGE_IO" })
      .mockResolvedValueOnce(notes("report recovered"));
    vi.mocked(native.recentWorkbenchFiles).mockResolvedValue([
      { id: "file-2", name: "report.txt", path: "unused", directory: false },
    ]);
    const user = userEvent.setup();
    render(<Palette />);
    const input = screen.getByRole("combobox", { name: "Quick actions" });
    await user.type(input, "report");
    expect(
      await screen.findByRole("option", { name: /report.txt/ }),
    ).toBeVisible();
    const retry = within(screen.getByRole("status")).getByRole("button", {
      name: "Retry",
    });
    if (interaction === "keyboard") {
      await user.tab();
      expect(retry).toHaveFocus();
      await user.keyboard("{Enter}");
    } else {
      await user.click(retry);
    }
    expect(screen.getByRole("dialog", { name: "Quick actions" })).toBeVisible();
    expect(input).toHaveValue("report");
    expect(
      await screen.findByRole("option", { name: /report recovered/ }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  },
);

it("withdraws the failure when a changed query succeeds and retains the toast retry", async () => {
  vi.mocked(native.queryNotes)
    .mockRejectedValueOnce({ code: "STORAGE_IO" })
    .mockRejectedValueOnce({ code: "STORAGE_IO" })
    .mockResolvedValueOnce(notes("invoice recovered"));
  render(<Palette />);
  const input = screen.getByRole("combobox", { name: "Quick actions" });
  fireEvent.change(input, { target: { value: "report" } });
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  const action = vi.mocked(toast.error).mock.calls[0]?.[1]?.action as {
    label: string;
    onClick: () => void;
  };
  expect(action.label).toBe("Retry");
  act(() => action.onClick());
  expect(input).toHaveValue("report");
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Some content searches failed",
  );
  fireEvent.change(input, { target: { value: "invoice" } });
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("option", { name: /invoice recovered/ }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(input).toHaveValue("invoice");
});

it("uses one live status slot for loading and query limits", () => {
  render(<Palette />);
  const input = screen.getByRole("combobox", { name: "Quick actions" });
  const status = screen.getByRole("status");
  fireEvent.change(input, { target: { value: "report" } });
  expect(status).toHaveTextContent("Searching local content…");
  fireEvent.change(input, { target: { value: "x".repeat(201) } });
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toHaveTextContent("Content query limit: 200 UTF-8 bytes");
});

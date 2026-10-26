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
import { saveTextExport } from "@/lib/tauri";
import { JourneySamples } from "./journey-samples";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/tauri", () => ({ saveTextExport: vi.fn() }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});

describe("journey sample downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveTextExport).mockResolvedValue("saved.txt");
  });
  afterEach(cleanup);

  it("shows download failures through toast, keeps the actions in place and allows retry", async () => {
    vi.mocked(saveTextExport).mockRejectedValueOnce(new Error("Disk full"));
    render(<JourneySamples path="/workbench" />);
    const download = screen.getByRole("button", {
      name: "Download original text",
    });
    fireEvent.click(download);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Disk full"),
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(download).toBeEnabled();
    expect(
      screen.queryByText(/Save samples in a dedicated/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save samples in a dedicated/ }),
    ).toBeEnabled();
    fireEvent.click(download);
    await waitFor(() => expect(saveTextExport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(download).toBeEnabled());
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("does not publish an old download error after leaving the guide", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(saveTextExport).mockReturnValue(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    const view = render(<JourneySamples path="/tasks" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Download original text" }),
    );
    view.unmount();
    await act(async () => reject(new Error("Late failure")));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

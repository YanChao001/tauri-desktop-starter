import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/providers/i18n";
import { SettingsProvider, STORAGE_KEY } from "@/providers/settings";
import { NativePage } from "./native-page";
vi.mock("@/lib/tauri", () => ({ isTauri: () => false }));
describe("browser capability preview", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
  it.each([
    { mode: "demo", links: ["/catalog", "/settings"] },
    { mode: "minimal", links: ["/", "/settings"] },
  ])(
    "keeps $mode destinations consistent without rendering native operations",
    ({ mode, links }) => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ language: "en", appMode: mode }),
      );
      render(
        <MemoryRouter>
          <SettingsProvider>
            <I18nProvider>
              <NativePage title="Windows" description="Native capabilities">
                <button>Change system settings</button>
              </NativePage>
            </I18nProvider>
          </SettingsProvider>
        </MemoryRouter>,
      );
      expect(
        screen.queryByRole("button", { name: "Change system settings" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("link").map((link) => link.getAttribute("href")),
      ).toEqual(links);
      expect(
        screen.getByText(/This feature requires the desktop app/),
      ).toBeVisible();
    },
  );
});

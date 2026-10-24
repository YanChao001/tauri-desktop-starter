import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExtensionOutput } from "./extension-output";
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(cleanup);
it("renders Markdown without HTML, executable links or remote images", () => {
  render(
    <ExtensionOutput
      format="markdown"
      text={
        "# Report\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![remote](https://example.com/image.png)"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Report" })).toBeVisible();
  expect(
    document.querySelector("script, img, a[href^='javascript:']"),
  ).toBeNull();
});
it("formats JSON and retains the original when formatting fails", () => {
  const view = render(<ExtensionOutput format="json" text={'{"count":2}'} />);
  expect(view.container.textContent).toBe('{\n  "count": 2\n}');
  view.rerender(<ExtensionOutput format="json" text="invalid" />);
  expect(screen.getByText("invalid")).toBeVisible();
});

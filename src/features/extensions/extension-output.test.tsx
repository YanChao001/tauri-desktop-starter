import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExtensionOutput } from "./extension-output";
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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

it.each([
  JSON.stringify({ value: "x".repeat(64 * 1024) }),
  JSON.stringify({ value: "中".repeat(22_000) }),
  "[".repeat(17) + "0" + "]".repeat(17),
])("retains large or deeply nested JSON without adding indentation", (text) => {
  const view = render(<ExtensionOutput format="json" text={text} />);
  expect(view.container.textContent).toBe(text);
});

it("counts nesting outside strings and still formats a small result at the depth limit", () => {
  const quoted = JSON.stringify({ value: '{["\\'.repeat(32) });
  const view = render(<ExtensionOutput format="json" text={quoted} />);
  expect(view.container.textContent).toBe(
    JSON.stringify(JSON.parse(quoted) as unknown, null, 2),
  );
  const nested = "[".repeat(16) + "0" + "]".repeat(16);
  view.rerender(<ExtensionOutput format="json" text={nested} />);
  expect(view.container.textContent).toContain("\n");
  expect(JSON.parse(view.container.textContent ?? "") as unknown).toEqual(
    JSON.parse(nested) as unknown,
  );
});

it("does not parse the same result again when its parent rerenders", () => {
  const text = '{"count":12345}';
  const parse = vi.spyOn(JSON, "parse");
  const view = render(<ExtensionOutput format="json" text={text} />);
  const parses = () => parse.mock.calls.filter(([input]) => input === text);
  expect(parses()).toHaveLength(1);
  view.rerender(<ExtensionOutput format="json" text={text} />);
  expect(parses()).toHaveLength(1);
  view.rerender(<ExtensionOutput format="text" text={text} />);
  expect(view.container.textContent).toBe(text);
});

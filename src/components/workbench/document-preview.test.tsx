import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./document-preview";

afterEach(cleanup);
describe("safe Markdown preview", () => {
  it("renders headings, lists and code while keeping HTML and remote resources inert", () => {
    const { container } = render(
      <MarkdownPreview
        content={
          '# Heading\n- First\n- Second\n<img src="https://example.com/track" onerror="alert(1)">\n```html\n<script>run()</script>\n```'
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Heading" })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("img, script, iframe")).toBeNull();
    expect(screen.getByText(/<img src=/)).toBeVisible();
    expect(screen.getByText("<script>run()</script>")).toBeVisible();
  });
});

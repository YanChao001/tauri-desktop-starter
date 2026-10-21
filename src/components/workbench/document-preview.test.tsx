import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentPreview, MarkdownPreview } from "./document-preview";

afterEach(cleanup);
describe("safe Markdown preview", () => {
  it("Rust 与 JSON 围栏复用安全高亮，其他语言保持纯文本", () => {
    const { container } = render(
      <MarkdownPreview
        content={
          '```rust\npub fn main() {}\n```\n```json\n{"ready": true}\n```'
        }
      />,
    );
    expect(
      container.querySelector(
        'code[data-language="rust"] [data-token="keyword"]',
      ),
    ).toHaveTextContent("pub");
    expect(
      container.querySelector(
        'code[data-language="json"] [data-token="boolean"]',
      ),
    ).toHaveTextContent("true");
  });
  it(".rs 文件按 Rust 着色，预览保留完整文本", () => {
    const content = 'pub fn greet() -> &\'static str { "hello" }';
    const { container } = render(
      <DocumentPreview
        document={{
          id: "rust",
          name: "main.RS",
          path: "/source/main.RS",
          kind: "text",
          content,
          previewUrl: null,
          revision: "1",
          bytes: content.length,
        }}
        content={content}
      />,
    );
    expect(container.querySelector("code")).toHaveAttribute(
      "data-language",
      "rust",
    );
    expect(container.querySelector("pre")?.textContent).toBe(content);
    expect(container.querySelector('[data-token="keyword"]')).toHaveTextContent(
      "pub",
    );
  });
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

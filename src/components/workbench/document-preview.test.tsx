import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentPreview, MarkdownPreview } from "./document-preview";

afterEach(cleanup);
describe("safe Markdown preview", () => {
  it("Rust 与 JSON 围栏复用安全高亮，未知语言保持纯文本", () => {
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
  it.each(["ts", "typescript", "TypeScript filename=bridge.ts"])(
    "%s 围栏复用 TypeScript 高亮",
    (language) => {
      const { container } = render(
        <MarkdownPreview
          content={"```" + language + "\nexport const ready = true;\n```"}
        />,
      );
      expect(
        container.querySelector(
          'code[data-language="typescript"] [data-token="keyword"]',
        ),
      ).toHaveTextContent("export");
    },
  );
  it("带文件名的 rs 围栏按 Rust 高亮，保留换行与缩进", () => {
    const source = 'pub fn main() {\n    println!("你好");\n}';
    const { container } = render(
      <MarkdownPreview
        content={"```RS filename=main.rs\n" + source + "\n```"}
      />,
    );
    const code = container.querySelector('code[data-language="rust"]');
    expect(code?.textContent).toBe(source);
    expect(code?.querySelector('[data-token="keyword"]')).toHaveTextContent(
      "pub",
    );
    expect(code?.querySelector('[data-token="string"]')).toHaveTextContent(
      '"你好"',
    );
  });
  it.each(["bridge.ts", "bridge.MTS", "bridge.cts"])(
    "%s 文件使用 TypeScript 高亮",
    (name) => {
      const content = 'const message: string = "你好";';
      const { container } = render(
        <DocumentPreview
          document={{
            id: name,
            name,
            path: "/source/" + name,
            kind: "text",
            content,
            previewUrl: null,
            revision: "1",
            bytes: content.length,
          }}
          content={content}
        />,
      );
      expect(
        container.querySelector('code[data-language="typescript"]')
          ?.textContent,
      ).toBe(content);
      expect(
        container.querySelector('[data-token="keyword"]'),
      ).toHaveTextContent("const");
    },
  );
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

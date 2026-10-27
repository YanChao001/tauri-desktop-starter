import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeBlock, tokenizeJson } from "./code-block";

describe("safe JSON code display", () => {
  afterEach(cleanup);
  it("highlights JSON types while preserving every original character for selection", () => {
    const code =
      '{\n  "escaped\\" key": "true and null", "count": -1.25e+3, "ready": true, "missing": null\n}';
    render(<CodeBlock code={code} language="json" aria-label="JSON preview" />);
    const preview = screen.getByLabelText("JSON preview");
    expect(preview.textContent).toBe(code);
    expect(preview.querySelector('[data-token="property"]')).toHaveTextContent(
      '"escaped\\" key"',
    );
    expect(preview.querySelector('[data-token="string"]')).toHaveTextContent(
      '"true and null"',
    );
    expect(preview.querySelector('[data-token="number"]')).toHaveTextContent(
      "-1.25e+3",
    );
    expect(preview.querySelector('[data-token="boolean"]')).toHaveTextContent(
      "true",
    );
    expect(preview.querySelector('[data-token="null"]')).toHaveTextContent(
      "null",
    );
    expect(preview).toHaveAttribute("tabindex", "0");
  });

  it("renders HTML-looking and script-looking log text without creating markup", () => {
    const payload =
      '</code><img src=x onerror="alert(1)"><script>alert(1)</script>';
    const code = JSON.stringify(
      { log: payload, nested: { "<svg onload=alert(1)>": false } },
      null,
      2,
    );
    const { container } = render(<CodeBlock code={code} language="json" />);
    expect(container.querySelector("pre")!.textContent).toBe(code);
    expect(container.querySelector("script, img, svg")).toBeNull();
    expect(
      tokenizeJson(code)
        .map((token) => token.text)
        .join(""),
    ).toBe(code);
  });

  it("keeps incomplete JSON and plain source text readable without parsing errors", () => {
    for (const code of [
      '{"pending": "unfinished\\',
      '{"items": [true, false, null, 0]}',
    ]) {
      expect(
        tokenizeJson(code)
          .map((token) => token.text)
          .join(""),
      ).toBe(code);
    }
    const code = "const markup = '<div>text</div>';";
    const { container } = render(<CodeBlock code={code} language="text" />);
    expect(container.querySelector("pre")!.textContent).toBe(code);
    expect(container.querySelector("span, div div")).toBeNull();
  });

  it("Rust 高亮始终以 React 文本渲染，不将源码中的 HTML 转成元素", () => {
    const code = 'pub fn main() { println!(r#"<img src=x onerror=run()>"#); }';
    const { container } = render(<CodeBlock code={code} language="rust" />);
    expect(container.querySelector("code")).toHaveAttribute(
      "data-language",
      "rust",
    );
    expect(container.querySelector("pre")?.textContent).toBe(code);
    expect(container.querySelector('[data-token="keyword"]')).toHaveTextContent(
      "pub",
    );
    expect(container.querySelector("img, script")).toBeNull();
  });

  it("TypeScript 高亮保留原文，不执行看似 HTML 的源码", async () => {
    const code =
      'export const markup: string = "</code><img src=x onerror=run()>";';
    const { container } = render(
      <CodeBlock code={code} language="typescript" />,
    );
    expect(container.querySelector("pre")?.textContent).toBe(code);
    await waitFor(() =>
      expect(
        container.querySelector('[data-token="keyword"]'),
      ).toHaveTextContent("export"),
    );
    expect(container.querySelector('[data-token="string"]')).toHaveTextContent(
      "<img",
    );
    expect(container.querySelector("img, script, iframe")).toBeNull();
  });
});

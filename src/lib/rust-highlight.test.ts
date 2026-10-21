// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tokenizeRust } from "./rust-highlight";

describe("Rust 文本着色", () => {
  it("识别声明、类型、数字、宏和生命周期，并逐字保留原始源码", () => {
    const code =
      "pub fn title<'a>(value: &'a str) -> Option<u32> {\n  let n = 0xff_u32;\n  println!(\"你好 {}\", value);\n  Some(n)\n}";
    const tokens = tokenizeRust(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    const textOf = (kind: string) =>
      tokens
        .filter((token) => token.kind === kind)
        .map((token) => token.text)
        .join(" ");
    expect(textOf("keyword")).toContain("pub");
    expect(textOf("function")).toContain("title");
    expect(textOf("type")).toContain("Option");
    expect(textOf("lifetime")).toContain("'a");
    expect(textOf("macro")).toContain("println");
    expect(textOf("number")).toContain("0xff_u32");
  });

  it("字符串中的引号和注释标记不会打断原始字符串与嵌套注释", () => {
    const code =
      'let raw = r##"<script>/* quote \\" # */</script>"##;\n/* outer /* inner */ end */ let ch = \'x\'; // done\nlet bytes = br#"// raw"#;';
    const tokens = tokenizeRust(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    expect(
      tokens.some(
        (token) => token.kind === "string" && token.text.startsWith('r##"'),
      ),
    ).toBe(true);
    expect(
      tokens.some(
        (token) =>
          token.kind === "comment" &&
          token.text === "/* outer /* inner */ end */",
      ),
    ).toBe(true);
    expect(
      tokens.some((token) => token.kind === "string" && token.text === "'x'"),
    ).toBe(true);
    expect(
      tokens.some(
        (token) => token.kind === "string" && token.text === 'br#"// raw"#',
      ),
    ).toBe(true);
  });

  it.each([
    'let s = "unfinished\\',
    "/* open /* nested",
    "fn r#type<'a>() {}",
    "let 中文 = 1..10;",
  ])("未完成或 Unicode 源码保持可读：%s", (code) =>
    expect(
      tokenizeRust(code)
        .map((token) => token.text)
        .join(""),
    ).toBe(code),
  );

  it("大文件限制着色节点数量，保留全部文本", () => {
    const code = "let n = 42;\n".repeat(30_000);
    const tokens = tokenizeRust(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    expect(tokens.at(-1)?.kind).toBe("plain");
    expect(tokens.length).toBeLessThan(60_000);
  });
});

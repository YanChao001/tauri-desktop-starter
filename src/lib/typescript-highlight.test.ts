// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tokenizeTypeScript } from "./typescript-highlight";

describe("TypeScript 文本着色", () => {
  it("识别前端调用中的注释、关键字、函数、类型和字符串，逐字保留源码", () => {
    const code =
      '// 调用门面\nexport async function invokeGreet(name: string): Promise<string> {\n  const result = await commands.greet(name, "zh");\n  if (result.status === "error") throw new NativeBridgeError(result.error);\n  return result.data;\n}';
    const tokens = tokenizeTypeScript(code);
    const textOf = (kind: string) =>
      tokens
        .filter((token) => token.kind === kind)
        .map((token) => token.text)
        .join(" ");
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    expect(textOf("comment")).toContain("// 调用门面");
    expect(textOf("keyword")).toContain("export");
    expect(textOf("function")).toContain("invokeGreet");
    expect(textOf("type")).toContain("Promise");
    expect(textOf("string")).toContain('"zh"');
  });

  it.each([
    "const message = `你好 ${name.toUpperCase()}!`; // end",
    "const pattern = /https?:\\/\\/[^/]+/g; const quote = 'can\\'t';",
    'const unfinished: Promise<string> = call("',
    "/* 未结束的注释",
  ])("模板、正则、转义和未完成源码保留完整文本：%s", (code) => {
    expect(
      tokenizeTypeScript(code)
        .map((token) => token.text)
        .join(""),
    ).toBe(code);
  });

  it("大文件只着色前段，保留剩余内容与边界处的完整 Unicode 字符", () => {
    const prefix = " ".repeat(99_999);
    const code =
      prefix + "🐈\n" + "const value: string = 'text';\n".repeat(5_000);
    const tokens = tokenizeTypeScript(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    expect(tokens.at(-1)?.kind).toBe("plain");
    expect(tokens.length).toBeLessThan(10);
  });
});

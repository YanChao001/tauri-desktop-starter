import { useMemo, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { CodeLanguage } from "@/lib/code-language";
import { tokenizeRust, type RustToken } from "@/lib/rust-highlight";
import {
  tokenizeTypeScript,
  type TypeScriptToken,
} from "@/lib/typescript-highlight";

type TokenKind =
  | "plain"
  | "property"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation"
  | RustToken["kind"]
  | TypeScriptToken["kind"];
type Token = { kind: TokenKind; text: string };
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const LITERAL = /^(true|false|null)\b/;

/** 仅对文本进行词法分析，不解析或插入诊断内容中的标记 */
export function tokenizeJson(code: string): Token[] {
  const tokens: Token[] = [];
  const add = (kind: TokenKind, text: string) => {
    const previous = tokens.at(-1);
    if (kind === "plain" && previous?.kind === "plain") previous.text += text;
    else tokens.push({ kind, text });
  };
  let index = 0;
  while (index < code.length) {
    const character = code[index]!;
    if (character === '"') {
      const start = index++;
      let closed = false;
      while (index < code.length) {
        if (code[index] === "\\") {
          index += Math.min(2, code.length - index);
          continue;
        }
        if (code[index++] === '"') {
          closed = true;
          break;
        }
      }
      let next = index;
      while (next < code.length && /\s/.test(code[next]!)) next++;
      add(
        closed ? (code[next] === ":" ? "property" : "string") : "plain",
        code.slice(start, index),
      );
    } else if ("{}[],:".includes(character)) {
      add("punctuation", character);
      index++;
    } else if (character === "-" || /\d/.test(character)) {
      const number = NUMBER.exec(code.slice(index))?.[0];
      add(number ? "number" : "plain", number ?? character);
      index += number?.length ?? 1;
    } else {
      const literal = "tfn".includes(character)
        ? LITERAL.exec(code.slice(index))?.[0]
        : undefined;
      if (literal) {
        add(literal === "null" ? "null" : "boolean", literal);
        index += literal.length;
      } else {
        add("plain", character);
        index++;
      }
    }
  }
  return tokens;
}

type CodeBlockProps = Omit<
  ComponentProps<"pre">,
  "children" | "dangerouslySetInnerHTML"
> & {
  code: string;
  language: CodeLanguage;
};

/** 保留原始文本及其可选中性；新增语言时可扩展对应的词法分析器 */
export function CodeBlock({
  code,
  language,
  className,
  tabIndex = 0,
  ...props
}: CodeBlockProps) {
  const tokens = useMemo(
    () =>
      language === "json"
        ? tokenizeJson(code)
        : language === "rust"
          ? tokenizeRust(code)
          : language === "typescript"
            ? tokenizeTypeScript(code)
            : [{ kind: "plain" as const, text: code }],
    [code, language],
  );
  return (
    <pre
      {...props}
      tabIndex={tabIndex}
      className={cn(
        "code-block overflow-auto rounded-lg bg-muted/50 p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <code data-language={language}>
        {tokens.map((token, index) =>
          token.kind === "plain" ? (
            token.text
          ) : (
            <span
              key={index}
              className={`code-token code-token--${token.kind}`}
              data-token={token.kind}
            >
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}

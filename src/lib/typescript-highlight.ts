import { createLowlight } from "lowlight";
import typescript from "highlight.js/lib/languages/typescript";

export type TypeScriptToken = {
  kind:
    | "plain"
    | "keyword"
    | "type"
    | "function"
    | "comment"
    | "string"
    | "number"
    | "boolean"
    | "property";
  text: string;
};

// 只注册实际使用的语法；由成熟语法库识别模板字符串、正则和类型注解。
const highlighter = createLowlight({ typescript });
type HighlightNode = ReturnType<
  typeof highlighter.highlight
>["children"][number];
const KINDS: Readonly<Record<string, TypeScriptToken["kind"]>> = {
  "hljs-keyword": "keyword",
  "hljs-comment": "comment",
  "hljs-string": "string",
  "hljs-regexp": "string",
  "hljs-number": "number",
  "hljs-literal": "boolean",
  "hljs-built_in": "type",
  "hljs-type": "type",
  "hljs-title": "type",
  function_: "function",
  "hljs-attr": "property",
  "hljs-property": "property",
};

/** 将语法树转成纯文本 token，交给 React 渲染，不生成或插入 HTML。 */
export function tokenizeTypeScript(code: string): TypeScriptToken[] {
  let limit = Math.min(code.length, 100_000);
  if (limit < code.length && /[\uD800-\uDBFF]/.test(code[limit - 1] ?? ""))
    limit--;
  const tokens: TypeScriptToken[] = [];
  const add = (kind: TypeScriptToken["kind"], text: string) => {
    const previous = tokens.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else tokens.push({ kind, text });
  };
  const visit = (
    node: HighlightNode,
    inherited: TypeScriptToken["kind"] = "plain",
  ) => {
    if (node.type === "text") add(inherited, node.value);
    else if (node.type === "element") {
      let kind = inherited;
      const classes = node.properties.className;
      if (Array.isArray(classes)) {
        for (const name of classes) {
          if (typeof name === "string") kind = KINDS[name] ?? kind;
        }
      }
      for (const child of node.children) visit(child, kind);
    }
  };
  for (const node of highlighter.highlight("typescript", code.slice(0, limit))
    .children)
    visit(node);
  if (limit < code.length) add("plain", code.slice(limit));
  return tokens;
}

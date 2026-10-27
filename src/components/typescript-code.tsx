import { useMemo } from "react";
import { tokenizeTypeScript } from "@/lib/typescript-highlight";

/** 仅在实际展示 TypeScript 时加载语法库，着色仍由 React 文本节点组成。 */
export function TypeScriptCode({ code }: { code: string }) {
  const tokens = useMemo(() => tokenizeTypeScript(code), [code]);
  return tokens.map((token, index) =>
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
  );
}

export type RustToken = {
  kind:
    | "plain"
    | "keyword"
    | "type"
    | "function"
    | "macro"
    | "comment"
    | "string"
    | "number"
    | "lifetime"
    | "operator";
  text: string;
};

const KEYWORDS = new Set(
  "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while yield union try gen".split(
    " ",
  ),
);
const TYPES = /^(?:[ui](?:8|16|32|64|128|size)|f(?:32|64)|bool|char|str)$/;
const IDENTIFIER = /^(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*/u;
const NUMBER =
  /^(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.(?!\.)[\d_]*)?(?:[eE][+-]?[\d_]+)?)(?:[ui](?:8|16|32|64|128|size)|f(?:32|64))?/;
const CHARACTER =
  /^(?:b)?'(?:\\(?:u\{[\da-fA-F_]+\}|x[\da-fA-F]{2}|[\s\S])|[^'\\\r\n])'/u;
const LIFETIME = /^'[_\p{ID_Start}][_\p{ID_Continue}]*/u;

/** 只输出文本 token；识别 Rust 的嵌套注释、原始字符串与生命周期，不执行源码。 */
export function tokenizeRust(code: string): RustToken[] {
  const tokens: RustToken[] = [];
  // 有界着色避免大文件生成数十万个 DOM 节点；后续文本仍完整保留。
  const limit = Math.min(code.length, 100_000);
  let index = 0;
  let previousWord = "";
  const add = (kind: RustToken["kind"], end: number) => {
    const text = code.slice(index, end);
    const previous = tokens.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else tokens.push({ kind, text });
    index = end;
  };
  while (index < limit) {
    const rest = code.slice(index);
    if (rest.startsWith("//")) {
      const end = code.indexOf("\n", index);
      add("comment", end < 0 ? code.length : end);
      continue;
    }
    if (rest.startsWith("/*")) {
      let end = index + 2;
      let depth = 1;
      while (end < code.length && depth > 0) {
        if (code.startsWith("/*", end)) {
          depth++;
          end += 2;
        } else if (code.startsWith("*/", end)) {
          depth--;
          end += 2;
        } else end++;
      }
      add("comment", end);
      continue;
    }
    const raw = /^(?:br|cr|r)(#{0,255})"/.exec(rest);
    if (raw) {
      const delimiter = '"' + raw[1]!;
      const end = code.indexOf(delimiter, index + raw[0].length);
      add("string", end < 0 ? code.length : end + delimiter.length);
      continue;
    }
    const quote = /^(?:b|c)?"/.exec(rest);
    if (quote) {
      let end = index + quote[0].length;
      while (end < code.length) {
        if (code[end] === "\\") end += Math.min(2, code.length - end);
        else if (code[end++] === '"') break;
      }
      add("string", end);
      continue;
    }
    const character = CHARACTER.exec(rest)?.[0];
    if (character) {
      add("string", index + character.length);
      continue;
    }
    const lifetime = LIFETIME.exec(rest)?.[0];
    if (lifetime) {
      add("lifetime", index + lifetime.length);
      continue;
    }
    const number = /^\d/.test(rest) ? NUMBER.exec(rest)?.[0] : undefined;
    if (number) {
      add("number", index + number.length);
      continue;
    }
    const word = IDENTIFIER.exec(rest)?.[0];
    if (word) {
      const next = code.slice(index + word.length).trimStart();
      const macro = next.startsWith("!") && !next.startsWith("!=");
      const kind = KEYWORDS.has(word)
        ? "keyword"
        : macro
          ? "macro"
          : previousWord === "fn"
            ? "function"
            : TYPES.test(word) || /^\p{Lu}/u.test(word)
              ? "type"
              : next.startsWith("(")
                ? "function"
                : "plain";
      add(kind, index + word.length);
      previousWord = word;
      continue;
    }
    const whitespace = /^\s+/.exec(rest)?.[0];
    if (whitespace) {
      add("plain", index + whitespace.length);
      continue;
    }
    add(
      /[{}()[\],;:.#=+\-*/%&|!<>?@^~]/.test(code[index]!)
        ? "operator"
        : "plain",
      index + 1,
    );
    previousWord = "";
  }
  if (index < code.length) add("plain", code.length);
  return tokens;
}

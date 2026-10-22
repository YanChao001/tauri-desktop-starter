export type CodeLanguage = "json" | "rust" | "typescript" | "text";

/** 围栏首个单词是语言，后续文件名等元数据不影响高亮。 */
export function normalizeCodeLanguage(info = ""): CodeLanguage {
  switch (info.trim().split(/\s+/, 1)[0]?.toLowerCase()) {
    case "rust":
    case "rs":
      return "rust";
    case "ts":
    case "typescript":
      return "typescript";
    case "json":
      return "json";
    default:
      return "text";
  }
}

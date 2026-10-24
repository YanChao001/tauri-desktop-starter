export function safeMarkdownUrl(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "mailto:"].includes(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

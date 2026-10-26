import { useMemo } from "react";
import { SafeMarkdown } from "@/components/safe-markdown";
import type { ExtensionResultFormat } from "@/lib/tauri";

const JSON_PREVIEW_BYTES = 64 * 1024;
const JSON_PREVIEW_DEPTH = 16;

/** 限制缩进对结果体积的放大，避免阻塞宿主界面线程。 */
function formatJsonPreview(text: string): string {
  if (
    text.length > JSON_PREVIEW_BYTES ||
    new TextEncoder().encode(text).length > JSON_PREVIEW_BYTES
  )
    return text;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "[" || character === "{") {
      if (++depth > JSON_PREVIEW_DEPTH) return text;
    } else if (character === "]" || character === "}") depth--;
  }
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

export function ExtensionOutput({
  text,
  format,
}: {
  text: string;
  format: ExtensionResultFormat;
}) {
  const content = useMemo(
    () => (format === "json" ? formatJsonPreview(text) : text),
    [format, text],
  );
  if (format === "markdown") {
    return (
      <div
        className="h-80 overflow-auto rounded-md border p-3"
        aria-live="polite"
      >
        <SafeMarkdown content={text} />
      </div>
    );
  }
  return (
    <pre
      className="h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-all"
      aria-live="polite"
    >
      {content}
    </pre>
  );
}

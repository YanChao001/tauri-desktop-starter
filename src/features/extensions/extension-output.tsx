import { SafeMarkdown } from "@/components/safe-markdown";
import type { ExtensionResultFormat } from "@/lib/tauri";

export function ExtensionOutput({
  text,
  format,
}: {
  text: string;
  format: ExtensionResultFormat;
}) {
  if (format === "markdown") {
    return (
      <div
        className="max-h-96 overflow-auto rounded-md border p-3"
        aria-live="polite"
      >
        <SafeMarkdown content={text} />
      </div>
    );
  }
  let content = text;
  if (format === "json") {
    try {
      content = JSON.stringify(JSON.parse(text) as unknown, null, 2);
    } catch {
      /* Retain the original result if formatting fails. */
    }
  }
  return (
    <pre
      className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-all"
      aria-live="polite"
    >
      {content}
    </pre>
  );
}

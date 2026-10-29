import { Fragment, type ReactNode } from "react";
import { CodeBlock } from "@/components/code-block";
import { normalizeCodeLanguage } from "@/lib/code-language";
import type { WorkbenchDocument } from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";

const MAX_MARKDOWN_PREVIEW_LINES = 2000;

/** Markdown 只渲染 React 文本节点与固定元素，不执行 HTML 或加载远端资源。 */
export function MarkdownPreview({ content }: { content: string }) {
  const { t } = useI18n();
  const lines = content.split("\n", MAX_MARKDOWN_PREVIEW_LINES + 1);
  // 合法大小的文本仍可能包含数十万行；只限制结构化预览，编辑与保存保留全文。
  if (lines.length > MAX_MARKDOWN_PREVIEW_LINES)
    return (
      <div className="space-y-2">
        <p role="status" className="text-xs text-muted-foreground">
          {t("workbench.markdownPlainPreview")}
        </p>
        <CodeBlock
          code={content}
          language="text"
          className="whitespace-pre-wrap break-words"
        />
      </div>
    );
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const language = normalizeCodeLanguage(line.slice(3));
      const code: string[] = [];
      while (++index < lines.length && !lines[index]?.startsWith("```"))
        code.push(lines[index] ?? "");
      nodes.push(
        <CodeBlock key={index} code={code.join("\n")} language={language} />,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      nodes.push(
        <p
          key={index}
          role="heading"
          aria-level={heading[1]!.length}
          className="font-semibold text-foreground"
        >
          {heading[2]}
        </p>,
      );
    } else if (/^[-*]\s/.test(line)) {
      const items = [line.slice(2)];
      while (index + 1 < lines.length && /^[-*]\s/.test(lines[index + 1] ?? ""))
        items.push(lines[++index]!.slice(2));
      nodes.push(
        <ul key={index} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ul>,
      );
    } else if (line.trim()) {
      nodes.push(
        <p
          key={index}
          className="whitespace-pre-wrap break-words leading-relaxed"
        >
          {line}
        </p>,
      );
    } else
      nodes.push(
        <Fragment key={index}>
          <br />
        </Fragment>,
      );
  }
  return <div className="space-y-2 text-sm">{nodes}</div>;
}

export function DocumentPreview({
  document,
  content,
}: {
  document: WorkbenchDocument;
  content: string;
}) {
  if (document.kind === "image" && document.previewUrl)
    return (
      <img
        src={document.previewUrl}
        alt={document.name}
        className="max-h-[36rem] max-w-full rounded-md object-contain"
      />
    );
  if (document.kind === "markdown")
    return (
      <div
        className="max-h-[36rem] overflow-auto"
        role="region"
        aria-label={document.name}
        tabIndex={0}
      >
        <MarkdownPreview content={content} />
      </div>
    );
  return (
    <CodeBlock
      code={content}
      language={
        document.kind === "json"
          ? "json"
          : /\.rs$/i.test(document.name)
            ? "rust"
            : /\.(?:ts|mts|cts)$/i.test(document.name)
              ? "typescript"
              : "text"
      }
      className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words"
    />
  );
}

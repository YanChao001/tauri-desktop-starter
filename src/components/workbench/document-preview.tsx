import { Fragment, type ReactNode } from "react";
import { CodeBlock } from "@/components/code-block";
import type { WorkbenchDocument } from "@/lib/tauri";

/** Markdown 只渲染 React 文本节点与固定元素，不执行 HTML 或加载远端资源。 */
export function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++index < lines.length && !lines[index]?.startsWith("```"))
        code.push(lines[index] ?? "");
      nodes.push(<CodeBlock key={index} code={code.join("\n")} />);
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
    return <MarkdownPreview content={content} />;
  return (
    <CodeBlock
      code={content}
      language={document.kind === "json" ? "json" : "text"}
      className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words"
    />
  );
}

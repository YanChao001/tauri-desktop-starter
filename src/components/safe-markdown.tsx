import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/code-block";
import { ExternalLink } from "@/components/external-link";
import { normalizeCodeLanguage } from "@/lib/code-language";
import { safeMarkdownUrl } from "@/lib/markdown";
import { useI18n } from "@/providers/i18n";

export function SafeMarkdown({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 space-y-3 break-words text-sm [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_a]:text-(--surface-link-foreground) [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          table: ({ children }) => (
            <div
              role="region"
              aria-label={t("labs.media.table")}
              tabIndex={0}
              className="max-w-full overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table>{children}</table>
            </div>
          ),
          pre: ({ node }) => {
            const code = node?.children.find(
              (child) => child.type === "element" && child.tagName === "code",
            );
            if (code?.type !== "element") return null;
            const classes = code.properties.className;
            const languageClass = Array.isArray(classes)
              ? classes.find(
                  (name) =>
                    typeof name === "string" && name.startsWith("language-"),
                )
              : undefined;
            return (
              <CodeBlock
                code={code.children
                  .map((child) => (child.type === "text" ? child.value : ""))
                  .join("")}
                language={normalizeCodeLanguage(
                  typeof languageClass === "string"
                    ? languageClass.slice("language-".length)
                    : "",
                )}
                className="rounded-md p-3"
              />
            );
          },
          input: ({ checked }) => (
            <input
              type="checkbox"
              disabled
              checked={checked}
              aria-label={t(
                checked ? "labs.media.taskCompleted" : "labs.media.taskPending",
              )}
            />
          ),
          a: ({ href, children }) =>
            href && /^https?:/i.test(href) ? (
              <ExternalLink href={href}>{children}</ExternalLink>
            ) : href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="text-muted-foreground">
              [{t("labs.media.blockedImage")}
              {alt ? `: ${alt}` : ""}]
            </span>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

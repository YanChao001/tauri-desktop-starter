export function safeMarkdownUrl(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "mailto:"].includes(parsed.protocol) ? url : "";
  } catch {
    return "";
  }
}

export function mediaKind(file: Pick<File, "type" | "size">) {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) return null;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export function validWorkerInput(value: string) {
  const length = new TextEncoder().encode(value).length;
  return value.trim().length > 0 && length <= 1000;
}

export const demoMetrics = [
  { day: "1", requests: 120, latency: 82 },
  { day: "2", requests: 180, latency: 74 },
  { day: "3", requests: 145, latency: 91 },
  { day: "4", requests: 225, latency: 65 },
  { day: "5", requests: 260, latency: 71 },
  { day: "6", requests: 210, latency: 63 },
  { day: "7", requests: 290, latency: 58 },
];

export const initialMarkdown = `# Markdown lab

**GFM** · ~~deleted~~ · [Tauri](https://v2.tauri.app)

- [x] Local preview
- [ ] Your next idea

| Item | Value |
| --- | ---: |
| Demo | 42 |

\`\`\`json
{ "safe": true }
\`\`\`
`;

export function markdownExample(language: "zh" | "en") {
  return language === "zh"
    ? initialMarkdown
        .replace("Markdown lab", "Markdown 实验室")
        .replace("Local preview", "本地预览")
        .replace("Your next idea", "你的下一个想法")
        .replace("Item | Value", "项目 | 数值")
        .replace("Demo | 42", "演示 | 42")
    : initialMarkdown;
}

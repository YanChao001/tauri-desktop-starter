import { SafeMarkdown } from "@/components/safe-markdown";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { MediaPreview } from "./content-panels";

const bridge = vi.hoisted(() => ({
  native: false,
  open: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => bridge.native,
  openExternal: bridge.open,
}));

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ language: "en", t: createTranslator(en) }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  bridge.native = false;
  bridge.open.mockClear();
});

it("桌面 Markdown 网页链接自身打开系统浏览器", () => {
  bridge.native = true;
  render(<SafeMarkdown content="[Docs](https://example.com/docs)" />);
  fireEvent.click(screen.getByRole("link", { name: "Docs" }));
  expect(bridge.open).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/docs",
  );
});

it("renders GFM content without executing raw HTML, unsafe links or external images", () => {
  const { container } = render(
    <SafeMarkdown
      content={
        "# Safe\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![tracker](https://example.test/pixel)\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Safe" })).toBeVisible();
  expect(screen.getByRole("table")).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "Completed Markdown task" }),
  ).toBeChecked();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "unsafe" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/External image blocked/)).toBeVisible();
});

it.each([
  ["rust", "rust", "pub fn main() {}", "keyword", "pub"],
  ["rs", "rust", "pub fn main() {}", "keyword", "pub"],
  ["Rust filename=main.rs", "rust", "pub fn main() {}", "keyword", "pub"],
  ["ts", "typescript", "export const ready = true;", "keyword", "export"],
  [
    "TypeScript title=example.ts",
    "typescript",
    "export const ready = true;",
    "keyword",
    "export",
  ],
  ["JSON", "json", '{ "safe": true }', "property", '"safe"'],
])(
  "媒体 Markdown 的 %s 围栏按实际语言高亮",
  (info, language, source, token, text) => {
    const { container } = render(
      <SafeMarkdown content={"```" + info + "\n" + source + "\n```"} />,
    );
    const code = container.querySelector(`code[data-language="${language}"]`);
    expect(code?.textContent).toBe(source + "\n");
    expect(code?.querySelector(`[data-token="${token}"]`)).toHaveTextContent(
      text,
    );
    expect(code?.parentElement).toHaveAttribute("tabindex", "0");
    expect(container.querySelector("pre pre")).toBeNull();
  },
);

it.each(["", "html"])(
  "%s 围栏保留未知源码，标签不会变成可执行 HTML",
  (language) => {
    const source =
      '<img src="https://example.test/pixel" onerror="alert(1)">\n<script>run()</script>';
    const { container } = render(
      <SafeMarkdown content={"```" + language + "\n" + source + "\n```"} />,
    );
    const code = container.querySelector('code[data-language="text"]');
    expect(code?.textContent).toBe(source + "\n");
    expect(code?.querySelector("[data-token]")).toBeNull();
    expect(container.querySelector("img, script")).toBeNull();
  },
);

it("行内代码维持行内布局，未声明语言的缩进块保持纯文本", () => {
  const { container } = render(
    <SafeMarkdown content={"Call `lab_echo` here.\n\n    pub fn main() {}"} />,
  );
  expect(container.querySelector("p > code")).toHaveTextContent("lab_echo");
  expect(container.querySelector("p > code")).not.toHaveAttribute(
    "data-language",
  );
  expect(
    container.querySelector('pre > code[data-language="text"]')?.textContent,
  ).toBe("pub fn main() {}\n");
});

it("keeps the current preview after an invalid file and revokes local URLs on replace and unmount", () => {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:one")
    .mockReturnValueOnce("blob:two");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const { unmount } = render(<MediaPreview />);
  const input = screen.getByLabelText("Choose image, audio or video");
  fireEvent.change(input, {
    target: { files: [new File(["first"], "one.png", { type: "image/png" })] },
  });
  expect(screen.getByRole("img", { name: "one.png" })).toHaveAttribute(
    "src",
    "blob:one",
  );
  fireEvent.change(input, {
    target: {
      files: [new File(["not-media"], "private.txt", { type: "text/plain" })],
    },
  });
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("img", { name: "one.png" })).toHaveAttribute(
    "src",
    "blob:one",
  );
  expect(create).toHaveBeenCalledOnce();
  fireEvent.change(input, {
    target: { files: [new File(["second"], "two.png", { type: "image/png" })] },
  });
  expect(revoke).toHaveBeenCalledWith("blob:one");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:two");
});

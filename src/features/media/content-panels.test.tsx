import { SafeMarkdown } from "@/components/safe-markdown";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";
import { I18nContext } from "@/providers/i18n-context";
import { MediaPreview } from "./content-panels";

const bridge = vi.hoisted(() => ({
  native: false,
  open: vi.fn().mockResolvedValue(undefined),
}));
const preference = vi.hoisted(() => ({ motion: "full" }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => bridge.native,
  openExternal: bridge.open,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: preference }),
}));

vi.mock("@/providers/i18n", () => ({
  useI18n: () =>
    useContext(I18nContext) ?? { language: "en", t: createTranslator(en) },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  preference.motion = "full";
  bridge.native = false;
  bridge.open.mockClear();
  vi.mocked(toast.error).mockClear();
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

it("Markdown 表格保留表格语义，并提供有名称的键盘滚动区域", async () => {
  const user = userEvent.setup();
  render(<SafeMarkdown content={"| A | B |\n| - | - |\n| 1 | 2 |"} />);
  const region = screen.getByRole("region", { name: "Markdown table" });
  expect(within(region).getByRole("table")).toBeVisible();
  expect(within(region).getAllByRole("columnheader")).toHaveLength(2);
  await user.tab();
  expect(region).toHaveFocus();
});

it("更新 Markdown 表格内容时保留键盘焦点和局部滚动位置", () => {
  const { rerender } = render(
    <SafeMarkdown content={"| A | B |\n| - | - |\n| 1 | 2 |"} />,
  );
  const region = screen.getByRole("region", { name: "Markdown table" });
  region.focus();
  region.scrollLeft = 120;

  rerender(<SafeMarkdown content={"| A | B |\n| - | - |\n| 3 | 4 |"} />);

  expect(screen.getByRole("cell", { name: "3" })).toBeVisible();
  expect(region).toHaveFocus();
  expect(
    screen.getByRole("region", { name: "Markdown table" }).scrollLeft,
  ).toBe(120);
});

it("更新 Markdown 代码块时保留键盘焦点和局部滚动位置", () => {
  const { container, rerender } = render(
    <SafeMarkdown content={"```text\nfirst\n```"} />,
  );
  const block = container.querySelector("pre")!;
  block.focus();
  block.scrollTop = 80;

  rerender(<SafeMarkdown content={"```text\nsecond\n```"} />);

  expect(screen.getByText("second")).toBeVisible();
  expect(block).toHaveFocus();
  expect(container.querySelector("pre")?.scrollTop).toBe(80);
});

it("Markdown 内容不变时仍更新翻译，并保留表格的键盘位置", () => {
  const content =
    "| A |\n| - |\n| 1 |\n\n- [x] Done\n\n![image](https://example.test/image.png)";
  const { rerender } = render(
    <I18nContext.Provider value={{ language: "en", t: createTranslator(en) }}>
      <SafeMarkdown content={content} />
    </I18nContext.Provider>,
  );
  const region = screen.getByRole("region", { name: "Markdown table" });
  region.focus();

  rerender(
    <I18nContext.Provider value={{ language: "zh", t: createTranslator(zhCN) }}>
      <SafeMarkdown content={content} />
    </I18nContext.Provider>,
  );

  expect(screen.getByRole("region", { name: zhCN["labs.media.table"] })).toBe(
    region,
  );
  expect(region).toHaveFocus();
  expect(
    screen.getByRole("checkbox", { name: zhCN["labs.media.taskCompleted"] }),
  ).toBeChecked();
  expect(
    screen.getByText(new RegExp(zhCN["labs.media.blockedImage"])),
  ).toBeVisible();
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
  async (info, language, source, token, text) => {
    const { container } = render(
      <SafeMarkdown content={"```" + info + "\n" + source + "\n```"} />,
    );
    const code = container.querySelector(`code[data-language="${language}"]`);
    expect(code?.textContent).toBe(source + "\n");
    const expectHighlight = () =>
      expect(code?.querySelector(`[data-token="${token}"]`)).toHaveTextContent(
        text,
      );
    if (language === "typescript") await waitFor(expectHighlight);
    else expectHighlight();
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
  expect(toast.error).toHaveBeenCalledWith(
    createTranslator(en)("labs.media.invalidFile"),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "one.png" })).toHaveAttribute(
    "src",
    "blob:one",
  );
  expect(create).toHaveBeenCalledOnce();
  fireEvent.error(screen.getByRole("img", { name: "one.png" }));
  expect(toast.error).toHaveBeenLastCalledWith(
    createTranslator(en)("labs.media.decodeError"),
  );
  fireEvent.change(input, {
    target: { files: [new File(["second"], "two.png", { type: "image/png" })] },
  });
  expect(revoke).toHaveBeenCalledWith("blob:one");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:two");
});

it.each(["audio", "video"])(
  "%s 在隐藏页签、后台文档或播放器离屏时暂停，可见后等待用户播放",
  (kind) => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:media");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    let pageVisibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => pageVisibility,
    );
    let viewport: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          viewport = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    // 减少装饰动效不应阻止用户主动播放媒体。
    preference.motion = "reduced";
    const { container, rerender, unmount } = render(<MediaPreview />);
    fireEvent.change(screen.getByLabelText("Choose image, audio or video"), {
      target: {
        files: [
          new File(["media"], `sample.${kind}`, { type: `${kind}/test` }),
        ],
      },
    });
    const player = container.querySelector(kind);
    expect(player).toBeInstanceOf(HTMLMediaElement);
    expect(observe).toHaveBeenCalledExactlyOnceWith(player);
    fireEvent.play(player!);
    expect(pause).not.toHaveBeenCalled();

    rerender(<MediaPreview active={false} />);
    expect(pause).toHaveBeenCalledTimes(1);
    rerender(<MediaPreview active />);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);

    act(() => {
      pageVisibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(pause).toHaveBeenCalledTimes(2);
    act(() => {
      pageVisibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(2);

    act(() =>
      viewport?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(pause).toHaveBeenCalledTimes(3);
    fireEvent.play(player!);
    expect(pause).toHaveBeenCalledTimes(4);
    act(() =>
      viewport?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(4);
    fireEvent.play(player!);
    expect(pause).toHaveBeenCalledTimes(4);
    unmount();
    expect(pause).toHaveBeenCalledTimes(5);
    expect(disconnect).toHaveBeenCalledOnce();
  },
);

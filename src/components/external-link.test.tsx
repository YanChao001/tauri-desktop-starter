import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useExternalLinks } from "@/hooks/use-external-links";
import { isTauri, openExternal } from "@/lib/tauri";
import { ExternalLink } from "./external-link";

vi.mock("@/lib/tauri", () => ({
  isTauri: vi.fn(() => true),
  openExternal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const url = "https://example.com/docs";

function WithFallback() {
  useExternalLinks();
  return (
    <ExternalLink href={url}>
      <span>Docs</span>
    </ExternalLink>
  );
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(openExternal).mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("原生链接自身处理点击，父组件停止冒泡时也能打开", async () => {
  render(
    <div onClick={(event) => event.stopPropagation()}>
      <ExternalLink href={url}>
        <span>Docs</span>
      </ExternalLink>
    </div>,
  );
  await userEvent.click(screen.getByText("Docs"));
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
});

it("原生鼠标与 Enter 激活不会被全局兜底重复打开", async () => {
  render(<WithFallback />);
  const user = userEvent.setup();
  const link = screen.getByRole("link", { name: "Docs" });
  await user.click(link);
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
  link.focus();
  await user.keyboard("{Enter}");
  expect(openExternal).toHaveBeenCalledTimes(2);
});

it("原生中键只打开一次，右键保留上下文菜单语义", () => {
  render(<WithFallback />);
  const link = screen.getByRole("link", { name: "Docs" });
  fireEvent(
    link,
    new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
  );
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
  fireEvent(
    link,
    new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }),
  );
  expect(openExternal).toHaveBeenCalledTimes(1);
});

it("调用方可以取消打开行为", async () => {
  render(
    <ExternalLink href={url} onClick={(event) => event.preventDefault()}>
      Docs
    </ExternalLink>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Docs" }));
  expect(openExternal).not.toHaveBeenCalled();
});

it("浏览器保留新标签页、修饰键和链接地址", () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const defaultPrevented: boolean[] = [];
  render(
    <div
      onClick={(event) => {
        defaultPrevented.push(event.defaultPrevented);
        event.preventDefault();
      }}
    >
      <ExternalLink href={url}>Docs</ExternalLink>
    </div>,
  );
  const link = screen.getByRole("link", { name: "Docs" });
  expect(link).toHaveAttribute("href", url);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(link, { ctrlKey: true });
  expect(defaultPrevented).toEqual([false]);
  expect(openExternal).not.toHaveBeenCalled();
});

it("打开失败显示错误反馈", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(openExternal).mockRejectedValueOnce(new Error("denied"));
  render(<WithFallback />);
  await userEvent.click(screen.getByRole("link", { name: "Docs" }));
  expect(toast.error).toHaveBeenCalledExactlyOnceWith("common.openFailed");
});

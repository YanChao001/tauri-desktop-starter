import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";
import { rustIpcExample, typescriptIpcExample } from "@/features/catalog/model";
import { APP_CONFIG } from "@/config/app";
import Catalog from "./catalog";

const locale = vi.hoisted(() => ({ current: "en" as "en" | "zh" }));
const bridge = vi.hoisted(() => ({
  native: false,
  open: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => bridge.native,
  openExternal: bridge.open,
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { appMode: "demo" } }),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({
    language: locale.current,
    t: createTranslator(locale.current === "en" ? en : zhCN),
  }),
}));
afterEach(() => {
  cleanup();
  bridge.native = false;
  bridge.open.mockClear();
});

it.each(["en", "zh"] as const)(
  "%s 目录文档和源码链接直接调用系统浏览器入口",
  (language) => {
    bridge.native = true;
    locale.current = language;
    const t = createTranslator(language === "en" ? en : zhCN);
    render(<Catalog />, {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
    expect(
      screen.getByText(t("catalog.developerResources")).closest("details"),
    ).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(t("catalog.developerResources")));
    for (const [label, path] of [
      ["catalog.guide", "docs/development.md"],
      ["catalog.architecture", "docs/architecture.md"],
      ["catalog.testing", "docs/testing.md"],
    ] as const) {
      fireEvent.click(screen.getByRole("link", { name: t(label) }));
      expect(bridge.open).toHaveBeenLastCalledWith(
        `${APP_CONFIG.repositoryUrl}/blob/develop/${path}`,
      );
    }
    for (const label of ["catalog.source", "catalog.docs"] as const) {
      const [link] = screen.getAllByRole("link", { name: t(label) });
      if (!link) throw new Error("目录外链未渲染");
      fireEvent.click(link);
      expect(bridge.open).toHaveBeenLastCalledWith(
        new URL(link.getAttribute("href") ?? "").href,
      );
    }
    expect(bridge.open).toHaveBeenCalledTimes(5);
  },
);

it.each(["en", "zh"] as const)(
  "%s 能力目录将混合示例按语言着色并保留完整源码",
  async (language) => {
    locale.current = language;
    const t = createTranslator(language === "en" ? en : zhCN);
    render(<Catalog />, {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
    const resources = screen
      .getByText(t("catalog.developerResources"))
      .closest("details");
    expect(resources).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(t("catalog.developerResources")));
    expect(resources).toHaveAttribute("open");
    for (const [label, grammar, source, keyword, name] of [
      ["catalog.rustExample", "rust", rustIpcExample, "pub", "lab_echo"],
      [
        "catalog.typescriptExample",
        "typescript",
        typescriptIpcExample,
        "export",
        "labEcho",
      ],
    ] as const) {
      const block = screen.getByLabelText(t(label));
      expect(block).toHaveAttribute("tabindex", "0");
      expect(block.querySelector("code")).toHaveAttribute(
        "data-language",
        grammar,
      );
      expect(block.textContent).toBe(source);
      const expectKeyword = () =>
        expect(block.querySelector('[data-token="keyword"]')).toHaveTextContent(
          keyword,
        );
      if (grammar === "typescript") {
        // 等待真实懒加载完成，不让首次语法模块冷加载耗时决定页面断言结果。
        await act(async () => vi.dynamicImportSettled());
      }
      expectKeyword();
      expect(block.querySelector('[data-token="function"]')).toHaveTextContent(
        name,
      );
      expect(block.querySelector('[data-token="type"]')).not.toBeNull();
    }
    expect(
      screen
        .getByLabelText(t("catalog.rustExample"))
        .querySelector('[data-token="string"]'),
    ).toHaveTextContent('"Invalid input"');
  },
);

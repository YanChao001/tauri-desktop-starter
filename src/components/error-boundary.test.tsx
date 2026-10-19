import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";

function Boom(): ReactNode {
  throw new Error("渲染炸了");
}

describe("ErrorBoundary", () => {
  // React 捕获错误时会打 console.error，这里静音，避免测试输出被噪音淹没
  beforeEach(() => {
    delete document.documentElement.dataset.language;
    window.localStorage.setItem(
      "tauri-starter:settings",
      JSON.stringify({ language: "zh" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // vitest 未开 globals，Testing Library 不会自动 cleanup
    cleanup();
    window.localStorage.clear();
    delete document.documentElement.dataset.language;
    vi.restoreAllMocks();
  });

  it("正常时原样渲染子节点", () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("子组件抛错时给出错误文本，而不是白屏", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("界面出错了")).toBeInTheDocument();
    expect(screen.getByText("渲染炸了")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
  });

  it("provider 不可用时仍按已选英文显示错误入口", () => {
    window.localStorage.setItem(
      "tauri-starter:settings",
      JSON.stringify({ language: "en" }),
    );
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText("The interface encountered an error"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  it("存档无法写入时优先使用当前已应用的内存语言", () => {
    document.documentElement.dataset.language = "en";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  it.each(["字符串异常", null])("捕获非 Error 异常 %s", (error) => {
    function ThrowValue(): ReactNode {
      throw error;
    }
    render(
      <ErrorBoundary>
        <ThrowValue />
      </ErrorBoundary>,
    );
    expect(screen.getByText("界面出错了")).toBeInTheDocument();
    expect(screen.getByText(String(error))).toBeInTheDocument();
  });
});

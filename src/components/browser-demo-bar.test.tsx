import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_CONFIG } from "@/config/app";
import { createTranslator } from "@/i18n/translate";
import { zhCN } from "@/i18n/zh-CN";
import { BrowserDemoBar } from "./browser-demo-bar";

const state = vi.hoisted(() => ({ native: false, appMode: "demo" }));
vi.mock("@/lib/tauri", () => ({ isTauri: () => state.native }));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: { appMode: state.appMode } }),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: createTranslator(zhCN) }),
}));
function Location() {
  const { pathname } = useLocation();
  return <output aria-label="当前路由">{pathname}</output>;
}
function renderBar(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BrowserDemoBar />
      <Location />
    </MemoryRouter>,
  );
}
describe("同源浏览器演示入口", () => {
  beforeEach(() => {
    state.native = false;
    state.appMode = "demo";
  });
  afterEach(cleanup);
  it("明确演示身份，提供配置中的源码和桌面下载入口", () => {
    renderBar();
    expect(screen.getByRole("region", { name: "浏览器演示" })).toBeVisible();
    expect(screen.getByRole("link", { name: "源码" })).toHaveAttribute(
      "href",
      APP_CONFIG.repositoryUrl,
    );
    expect(screen.getByRole("link", { name: "下载桌面版" })).toHaveAttribute(
      "href",
      `${APP_CONFIG.repositoryUrl}/releases`,
    );
    expect(screen.getByRole("link", { name: "下载桌面版" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
  it("页面选择复用真实路由，不创建模拟场景", () => {
    renderBar();
    const navigation = screen.getByRole("combobox", { name: "切换演示页面" });
    fireEvent.change(navigation, { target: { value: "/motion" } });
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/motion");
    expect(navigation).toHaveValue("/motion");
  });
  it("精简模式保持相同导航可见性，直接访问隐藏路由仍能切换离开", () => {
    state.appMode = "minimal";
    renderBar("/components");
    expect(
      screen.queryByRole("option", { name: "动效实验室" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "切换演示页面" })).toHaveValue(
      "",
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "/settings" },
    });
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/settings");
  });
  it("原生窗口不显示浏览器入口", () => {
    state.native = true;
    renderBar();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

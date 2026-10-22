import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { zhCN } from "@/i18n/zh-CN";
import { CompactNavigation } from "./compact-navigation";

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
      <CompactNavigation />
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
  it("仅提供标题栏页面选择，不添加演示说明或下载外壳", () => {
    renderBar();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
  it("页面选择复用真实路由，不创建模拟场景", () => {
    renderBar();
    const navigation = screen.getByRole("combobox", { name: "切换演示页面" });
    fireEvent.keyDown(navigation, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "动效实验室" }));
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/motion");
    expect(navigation).toHaveTextContent("动效实验室");
  });
  it("精简模式保持相同导航可见性，直接访问隐藏路由仍能切换离开", () => {
    state.appMode = "minimal";
    renderBar("/components");
    const navigation = screen.getByRole("combobox", { name: "切换演示页面" });
    expect(navigation).toHaveTextContent("交互场景");
    fireEvent.keyDown(navigation, { key: "Enter" });
    expect(
      screen.queryByRole("option", { name: "动效实验室" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "设置" }));
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/settings");
  });
  it("原生窗口不显示浏览器入口", () => {
    state.native = true;
    renderBar();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

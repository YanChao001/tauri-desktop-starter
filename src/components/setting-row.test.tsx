import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingRow } from "./setting-row";

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key === "common.helpFor" ? `了解${values?.name}` : "帮助",
  }),
}));

afterEach(cleanup);

describe("设置行补充说明", () => {
  it("说明不占据常驻内容，键盘聚焦后可查看且保留操作控件", async () => {
    render(
      <SettingRow label="菜单栏" hint="在标题栏显示文件与编辑菜单。">
        <input type="checkbox" aria-label="菜单栏" />
      </SettingRow>,
    );
    expect(
      screen.queryByText("在标题栏显示文件与编辑菜单。"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "菜单栏" })).toBeEnabled();
    fireEvent.focus(screen.getByRole("button", { name: "了解菜单栏" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "在标题栏显示文件与编辑菜单。",
    );
  });

  it("带图标的标签可以提供完整的帮助名称", async () => {
    render(
      <SettingRow
        label={<span>自动启动</span>}
        helpLabel="了解自动启动"
        hint="登录系统后启动应用。"
      >
        <input type="checkbox" aria-label="自动启动" />
      </SettingRow>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "了解自动启动" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "登录系统后启动应用。",
    );
  });
});

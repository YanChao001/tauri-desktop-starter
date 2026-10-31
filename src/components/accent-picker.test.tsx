import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/lib/settings-model";
import { AccentPicker } from "./accent-picker";

type AccentSettings = Pick<AppSettings, "accent" | "customAccent">;
const state = vi.hoisted(() => ({
  settings: { accent: "neutral", customAccent: "#7C3AED" } as AccentSettings,
  update: vi.fn(),
}));
vi.mock("@/providers/settings", () => ({ useSettings: () => state }));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ language: "en", t: createTranslator(en) }) };
});

beforeEach(() => {
  state.settings = { accent: "neutral", customAccent: "#7C3AED" };
  state.update.mockReset();
  state.update.mockImplementation((patch: Partial<AccentSettings>) => {
    state.settings = { ...state.settings, ...patch };
  });
});
afterEach(cleanup);

describe("主题色选择器", () => {
  it("新旧预设保持按钮名称与选中语义，切换不会清除自定义原色", async () => {
    const user = userEvent.setup();
    const view = render(<AccentPicker />);
    expect(screen.getByRole("button", { name: "Neutral" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Cyan" }));
    expect(state.update).toHaveBeenLastCalledWith({ accent: "cyan" });
    view.rerender(<AccentPicker />);
    expect(screen.getByRole("button", { name: "Cyan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Neutral" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Rose" }));
    expect(state.update).toHaveBeenLastCalledWith({ accent: "rose" });
    expect(state.settings.customAccent).toBe("#7C3AED");
  });

  it("取色和输入只改草稿，Enter一次应用规范颜色并把焦点还给入口", async () => {
    const user = userEvent.setup();
    render(<AccentPicker />);
    const trigger = screen.getByRole("button", { name: "Custom" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Custom accent" })).toBeVisible();
    const input = screen.getByRole("textbox", { name: "HEX color" });
    expect(screen.getByRole("group", { name: "Pick a color" })).toBeVisible();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    await user.clear(input);
    await user.type(input, "#00ff00");
    const hue = screen.getByRole("slider", { name: "Hue" });
    expect(hue).toHaveAttribute("aria-valuenow", "120");
    hue.focus();
    await user.keyboard("{ArrowRight}");
    expect(input).toHaveValue("#00FF04");
    expect(state.update).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, " #abc ");
    expect(state.update).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      accent: "custom",
      customAccent: "#AABBCC",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("非法色值关联简短错误且不修改已保存主题，修正后可应用", async () => {
    const user = userEvent.setup();
    render(<AccentPicker />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    const input = screen.getByRole("textbox", { name: "HEX color" });
    await user.clear(input);
    await user.type(input, "var(--primary)");
    await user.click(screen.getByRole("button", { name: "Apply color" }));
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Enter #RGB or #RRGGBB, for example #7C3AED.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("#RRGGBB");
    expect(state.update).not.toHaveBeenCalled();
    expect(state.settings).toEqual({
      accent: "neutral",
      customAccent: "#7C3AED",
    });
    await user.clear(input);
    await user.type(input, "#00ff99");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply color" }));
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      accent: "custom",
      customAccent: "#00FF99",
    });
  });

  it("晚到外部设置不覆盖编辑，Esc取消后重新打开读取最新已保存颜色", async () => {
    const user = userEvent.setup();
    const view = render(<AccentPicker />);
    const trigger = screen.getByRole("button", { name: "Custom" });
    await user.click(trigger);
    const input = screen.getByRole("textbox", { name: "HEX color" });
    await user.clear(input);
    await user.type(input, "#112233");
    state.settings = { accent: "custom", customAccent: "#FEDCBA" };
    view.rerender(<AccentPicker />);
    expect(input).toHaveValue("#112233");
    await user.keyboard("{Escape}");
    expect(state.update).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "HEX color" })).toHaveValue(
      "#FEDCBA",
    );
  });

  it("从自定义切到预设后能重新应用保留的原色", async () => {
    state.settings = { accent: "custom", customAccent: "#FFFFFF" };
    const user = userEvent.setup();
    const view = render(<AccentPicker />);
    await user.click(screen.getByRole("button", { name: "Blue" }));
    view.rerender(<AccentPicker />);
    const trigger = screen.getByRole("button", { name: "Custom" });
    expect(trigger).toHaveAttribute("aria-pressed", "false");
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "HEX color" })).toHaveValue(
      "#FFFFFF",
    );
    await user.click(screen.getByRole("button", { name: "Apply color" }));
    expect(state.settings).toEqual({
      accent: "custom",
      customAccent: "#FFFFFF",
    });
    expect(trigger).toHaveAttribute("aria-pressed", "true");
  });

  it("灰色上选定的色相在增加饱和度后保留，HEX同步也保留灰色色相", async () => {
    const user = userEvent.setup();
    render(<AccentPicker />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    const input = screen.getByRole("textbox", { name: "HEX color" });
    fireEvent.change(input, { target: { value: "#0000FF" } });
    const hue = screen.getByRole("slider", { name: "Hue" });
    const saturation = screen.getByRole("slider", { name: "Saturation" });
    expect(hue).toHaveAttribute("aria-valuenow", "240");
    fireEvent.change(input, { target: { value: "#808080" } });
    expect(hue).toHaveAttribute("aria-valuenow", "240");
    expect(saturation).toHaveAttribute("aria-valuenow", "0");
    hue.focus();
    await user.keyboard("{ArrowRight}");
    expect(input).toHaveValue("#808080");
    expect(hue).toHaveAttribute("aria-valuenow", "241");
    saturation.focus();
    await user.keyboard("{End}");
    expect(hue).toHaveAttribute("aria-valuenow", "241");
    expect(saturation).toHaveAttribute("aria-valuenow", "100");
    expect(input).not.toHaveValue("#808080");
    expect(state.update).not.toHaveBeenCalled();
  });

  it("亮度滑到黑白端点后调回会恢复原色相和饱和度", async () => {
    state.settings = { accent: "custom", customAccent: "#00FF00" };
    const user = userEvent.setup();
    render(<AccentPicker />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    const input = screen.getByRole("textbox", { name: "HEX color" });
    const hue = screen.getByRole("slider", { name: "Hue" });
    const saturation = screen.getByRole("slider", { name: "Saturation" });
    const lightness = screen.getByRole("slider", { name: "Lightness" });
    lightness.focus();
    await user.keyboard("{Home}");
    expect(input).toHaveValue("#000000");
    await user.keyboard("{End}");
    expect(input).toHaveValue("#FFFFFF");
    expect(hue).toHaveAttribute("aria-valuenow", "120");
    expect(saturation).toHaveAttribute("aria-valuenow", "100");
    await user.keyboard("{Home}{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}");
    expect(input).toHaveValue("#00FF00");
    expect(state.update).not.toHaveBeenCalled();
  });
});

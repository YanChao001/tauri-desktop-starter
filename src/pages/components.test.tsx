import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import Components from "./components";

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("组件示例表单", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("控件具有关联标签，键盘调节滑块同步显示值", () => {
    render(
      <TooltipProvider>
        <Components />
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("textbox", { name: "components.name" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "components.email" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "components.role" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "components.plan" }),
    ).toBeVisible();
    const slider = screen.getByRole("slider", { name: "components.volume" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "65");
    expect(screen.getByRole("status")).toHaveTextContent("65");
  });
});

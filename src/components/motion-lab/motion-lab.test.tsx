import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zhMotion } from "@/i18n/zh-motion";
import MotionLab from "@/pages/motion";

const activity = vi.hoisted(() => ({ reduced: false, visible: true }));
const controls = vi.hoisted(
  () =>
    [] as Array<{
      pause: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      state: string;
    }>,
);
vi.mock("@/hooks/use-demo-motion", () => ({
  useDemoMotion: (_ref: unknown, enabled: boolean) => ({
    ...activity,
    active: !activity.reduced && activity.visible && enabled,
  }),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: keyof typeof zhMotion) => zhMotion[key] }),
}));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    animate: vi.fn(() => {
      const control = {
        pause: vi.fn(),
        play: vi.fn(),
        stop: vi.fn(),
        state: "running",
      };
      controls.push(control);
      return control;
    }),
  };
});

describe("interactive motion laboratory", () => {
  afterEach(cleanup);
  beforeEach(() => {
    activity.reduced = false;
    activity.visible = true;
    controls.length = 0;
  });

  it("changes physical controls and supports keyboard scene navigation", async () => {
    const user = userEvent.setup();
    render(<MotionLab />);
    const stiffness = screen.getByRole("slider", { name: /弹簧刚度/ });
    fireEvent.change(stiffness, { target: { value: "280" } });
    expect(stiffness).toHaveValue("280");
    await user.click(screen.getByRole("button", { name: "俏皮" }));
    expect(stiffness).toHaveValue("220");
    const spring = screen.getByRole("tab", { name: "弹簧物理" });
    spring.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "空间变换" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("空间变换");
    await user.click(screen.getAllByRole("button", { name: "探索" })[0]!);
    expect(screen.getByText(zhMotion["lab.discoverDetail"])).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重播" }));
    expect(screen.getByText(zhMotion["lab.atelierDetail"])).toBeVisible();
  });

  it("pauses all imperative animations, resumes, and stops them on navigation/unmount", async () => {
    const user = userEvent.setup();
    const view = render(<MotionLab />);
    const springControls = [...controls];
    expect(springControls.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "暂停" }));
    for (const control of springControls)
      expect(control.pause).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "继续" }));
    for (const control of springControls)
      expect(control.play).toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "星轨绘制" }));
    for (const control of springControls)
      expect(control.stop).toHaveBeenCalled();
    const paths = controls.slice(springControls.length);
    activity.visible = false;
    view.rerender(<MotionLab />);
    for (const control of paths) expect(control.pause).toHaveBeenCalled();
    view.unmount();
    for (const control of paths) expect(control.stop).toHaveBeenCalled();
  });

  it("keeps reduced-motion interactions usable without starting imperative loops", async () => {
    activity.reduced = true;
    const user = userEvent.setup();
    render(<MotionLab />);
    expect(screen.getByRole("button", { name: "暂停" })).toBeDisabled();
    expect(screen.getByText(zhMotion["lab.reducedHint"])).toBeVisible();
    await user.click(screen.getByRole("button", { name: "送到另一侧" }));
    await user.click(screen.getByRole("tab", { name: "光影触感" }));
    const card = screen.getByRole("button", {
      name: new RegExp(zhMotion["lab.cardFront"]),
    });
    card.focus();
    await user.keyboard("{Enter}");
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(zhMotion["lab.cardBack"])).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "星轨绘制" }));
    await user.click(screen.getByRole("button", { name: "星光爆发" }));
    expect(screen.getByRole("button", { name: "收拢星光" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(controls).toHaveLength(0);
  });

  it("keeps layout controls and focus stable when visibility or motion preferences change", async () => {
    const user = userEvent.setup();
    const view = render(<MotionLab />);
    await user.click(screen.getByRole("tab", { name: "空间变换" }));
    const choice = screen.getAllByRole("button", { name: "记录" })[0]!;
    choice.focus();
    activity.visible = false;
    view.rerender(<MotionLab />);
    expect(choice).toBeInTheDocument();
    expect(choice).toHaveFocus();
    activity.visible = true;
    activity.reduced = true;
    view.rerender(<MotionLab />);
    expect(screen.getAllByRole("button", { name: "记录" })[0]).toBe(choice);
    expect(choice).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(choice).toHaveAttribute("aria-pressed", "true");
  });

  it("freezes and resumes an in-flight flip without replacing its playback controller", async () => {
    const user = userEvent.setup();
    const view = render(<MotionLab />);
    await user.click(screen.getByRole("tab", { name: "光影触感" }));
    await user.click(screen.getByRole("button", { name: "翻转卡片" }));
    const flip = controls.at(-1)!;
    const count = controls.length;
    activity.visible = false;
    view.rerender(<MotionLab />);
    expect(flip.pause).toHaveBeenCalled();
    expect(flip.stop).not.toHaveBeenCalled();
    expect(controls).toHaveLength(count);
    activity.visible = true;
    view.rerender(<MotionLab />);
    expect(flip.play).toHaveBeenCalled();
    expect(controls).toHaveLength(count);
    view.unmount();
    expect(flip.stop).toHaveBeenCalled();
  });
});

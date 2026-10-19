import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Progress } from "./ui/progress";

describe("Progress", () => {
  afterEach(cleanup);

  it("向辅助技术暴露当前值并按 max 计算可见进度", () => {
    const { container } = render(
      <Progress value={25} max={50} aria-label="Upload" />,
    );
    const progress = screen.getByRole("progressbar", { name: "Upload" });
    expect(progress).toHaveAttribute("aria-valuenow", "25");
    expect(progress).toHaveAttribute("aria-valuemax", "50");
    expect(progress).toHaveAttribute("aria-valuetext", "50%");
    expect(
      container.querySelector('[data-slot="progress-indicator"]'),
    ).toHaveStyle({ transform: "translateX(-50%)" });
  });

  it.each([undefined, null, Number.NaN, -1, 101])(
    "无有效数值 %s 时保持不确定状态且不生成无效 CSS",
    (value) => {
      const { container } = render(<Progress value={value} />);
      expect(screen.getByRole("progressbar")).not.toHaveAttribute(
        "aria-valuenow",
      );
      expect(
        container.querySelector('[data-slot="progress-indicator"]'),
      ).toHaveStyle({ transform: "translateX(-100%)" });
    },
  );
});

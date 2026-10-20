import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { PatternArtwork, WindowBackground } from "./window-background";

const appearance = vi.hoisted(() => ({ background: "starlight" }));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: appearance }),
}));

afterEach(cleanup);

describe("窗口插画", () => {
  it("同时预览所有皮肤时，SVG 资源引用只指向各自实例", () => {
    const { container } = render(
      <>
        {BACKGROUNDS.map((kind) => (
          <PatternArtwork key={kind} kind={kind} preview />
        ))}
        <PatternArtwork kind="sakura" />
        <PatternArtwork kind="starlight" />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      for (const element of svg.querySelectorAll("[href], [fill]")) {
        const reference =
          element.getAttribute("href")?.slice(1) ??
          element.getAttribute("fill")?.match(/^url\(#(.+)\)$/)?.[1];
        if (reference)
          expect(svg.querySelector(`[id="${reference}"]`)).not.toBeNull();
      }
    }
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each(BACKGROUNDS)(
    "%s 保持为轻量静态矢量，不嵌入位图或加载外部资源",
    (kind) => {
      const { container } = render(<PatternArtwork kind={kind} preview />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
      expect(
        svg.querySelectorAll(
          "filter, image, foreignObject, animate, animateTransform",
        ),
      ).toHaveLength(0);
      expect(svg.querySelectorAll("*").length).toBeLessThan(100);
      for (const reference of svg.querySelectorAll("[href]")) {
        expect(reference.getAttribute("href")).toMatch(/^#/);
      }
    },
  );

  it("全窗背景随设置切换，保持独立于内容的装饰层", () => {
    appearance.background = "starlight";
    const { container, rerender } = render(<WindowBackground />);
    expect(container.querySelector("[data-window-background]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "data-pattern",
      "starlight",
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "preserveAspectRatio",
      "xMidYMid slice",
    );
    appearance.background = "moonlit";
    rerender(<WindowBackground />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "data-pattern",
      "moonlit",
    );
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
  });
});

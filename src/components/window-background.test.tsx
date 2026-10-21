import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_BACKGROUNDS } from "@/lib/backgrounds";
import type { CustomBackground } from "@/lib/background-image";
import { PatternArtwork, WindowBackground } from "./window-background";

const appearance = vi.hoisted(() => ({
  background: "starlight",
  customBackground: null as CustomBackground | null,
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: appearance }),
}));

afterEach(cleanup);

describe("窗口插画", () => {
  it("同时预览所有皮肤时，SVG 资源引用只指向各自实例", () => {
    const { container } = render(
      <>
        {BUILTIN_BACKGROUNDS.map((kind) => (
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

  it.each(BUILTIN_BACKGROUNDS)(
    "%s 保持为轻量静态矢量，不嵌入位图或加载外部资源",
    (kind) => {
      const { container } = render(<PatternArtwork kind={kind} preview />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("preserveAspectRatio", "xMidYMid slice");
      if (kind === "sakura")
        expect(svg).toHaveAttribute("data-art-style", "anime");
      else expect(svg).not.toHaveAttribute("data-art-style", "anime");
      expect(
        svg.querySelectorAll(
          "filter, radialGradient, image, foreignObject, animate, animateTransform, [filter]",
        ),
      ).toHaveLength(0);
      expect(svg.querySelectorAll("*").length).toBeLessThan(100);
      for (const reference of svg.querySelectorAll("[href]")) {
        expect(reference.getAttribute("href")).toMatch(/^#/);
      }
    },
  );

  it("八款皮肤具有独立的风格，动漫只占一种", () => {
    const { container } = render(
      <>
        {BUILTIN_BACKGROUNDS.filter((kind) => kind !== "plain").map((kind) => (
          <PatternArtwork key={kind} kind={kind} preview />
        ))}
      </>,
    );
    const styles = [...container.querySelectorAll("svg")].map((svg) =>
      svg.getAttribute("data-art-style"),
    );
    expect(styles).toHaveLength(8);
    expect(new Set(styles).size).toBe(8);
    expect(styles.filter((style) => style === "anime")).toHaveLength(1);
  });

  it("导入的图片仍是不可交互装饰，保留显示方式并可切回矢量皮肤", () => {
    appearance.background = "custom";
    appearance.customBackground = {
      name: "sky.webp",
      dataUrl: "data:image/webp;base64," + btoa("RIFF0000WEBP"),
      fit: "contain",
    };
    const { container, rerender } = render(<WindowBackground />);
    const image = container.querySelector("[data-custom-background]")!;
    expect(image).toHaveAttribute("src", appearance.customBackground.dataUrl);
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveStyle({ objectFit: "contain" });
    expect(screen.queryByRole("img")).toBeNull();
    appearance.background = "aurora";
    rerender(<WindowBackground />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute(
      "data-pattern",
      "aurora",
    );
    appearance.customBackground = null;
  });

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

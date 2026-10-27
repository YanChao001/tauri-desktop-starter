import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_BACKGROUNDS } from "@/lib/backgrounds";
import type { CustomBackground } from "@/lib/background-image";
import { PatternArtwork, WindowBackground } from "./window-background";

const sources = import.meta.glob<string>("../../resources/skins/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});
const appearance = vi.hoisted(() => ({
  background: "starlight",
  customBackground: null as CustomBackground | null,
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: appearance }),
}));

afterEach(cleanup);

describe("窗口插画", () => {
  it("预览与实际背景加载相同的独立 SVG，装饰不进入阅读和焦点顺序", () => {
    const { container } = render(
      <>
        {BUILTIN_BACKGROUNDS.map((kind) => (
          <PatternArtwork key={kind} kind={kind} preview />
        ))}
        <PatternArtwork kind="sakura" />
        <PatternArtwork kind="starlight" />
      </>,
    );
    const previews = container.querySelectorAll(
      ".pattern-artwork--preview .skin-scene",
    );
    expect(previews).toHaveLength(
      BUILTIN_BACKGROUNDS.filter((kind) => kind !== "plain").length,
    );
    expect(
      new Set(
        [...previews].map((image) => (image as HTMLElement).style.maskImage),
      ).size,
    ).toBe(previews.length);
    for (const kind of ["sakura", "starlight"]) {
      const instances = container.querySelectorAll(
        `[data-pattern="${kind}"] .skin-scene`,
      );
      expect(instances).toHaveLength(2);
      expect((instances[0] as HTMLElement).style.maskImage).toBe(
        (instances[1] as HTMLElement).style.maskImage,
      );
    }
    for (const image of container.querySelectorAll(".skin-scene")) {
      expect(image.closest("[aria-hidden]")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
    expect(
      container.querySelector('[data-pattern="plain"] .skin-scene'),
    ).toBeNull();
    expect(
      container.querySelector("svg, button, a, input, [tabindex]"),
    ).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each(Object.entries(sources))(
    "%s 是有界静态矢量，资源引用留在图片内部",
    (_path, source) => {
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      expect(document.querySelector("parsererror")).toBeNull();
      const svg = document.documentElement;
      expect(
        svg.querySelectorAll(
          "script, filter, radialGradient, image, foreignObject, animate, animateTransform, [filter]",
        ),
      ).toHaveLength(0);
      expect(svg.querySelectorAll("*").length).toBeLessThan(80);
      expect(new Blob([source]).size).toBeLessThan(16 * 1024);
      for (const reference of svg.querySelectorAll("[href]")) {
        const href = reference.getAttribute("href")!;
        expect(href).toMatch(/^#/);
        expect(svg.querySelector(href)).not.toBeNull();
      }
      expect(source).not.toMatch(
        /(?:data:|https?:\/\/)(?!www\.w3\.org\/2000\/svg)/,
      );
    },
  );

  it("导入图片保留显示方式，切回皮肤时卸载自定义图片", () => {
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
    expect(container.querySelector("[data-custom-background]")).toBeNull();
    expect(container.querySelector(".pattern-artwork")).toHaveAttribute(
      "data-pattern",
      "aurora",
    );
    expect(
      (container.querySelector(".skin-scene") as HTMLElement).style.maskImage,
    ).toContain("cat-doodles.svg");
    appearance.customBackground = null;
  });

  it("全窗背景随设置切换，保持独立于内容的装饰层", () => {
    appearance.background = "starlight";
    const { container, rerender } = render(<WindowBackground />);
    expect(container.querySelector("[data-window-background]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const before = (container.querySelector(".skin-scene") as HTMLElement).style
      .maskImage;
    appearance.background = "moonlit";
    rerender(<WindowBackground />);
    expect(container.querySelector(".pattern-artwork")).toHaveAttribute(
      "data-pattern",
      "moonlit",
    );
    expect(
      (container.querySelector(".skin-scene") as HTMLElement).style.maskImage,
    ).not.toBe(before);
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
  });
});

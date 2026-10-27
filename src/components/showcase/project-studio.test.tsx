import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStudio } from "./project-studio";

const preferences = vi.hoisted(() => ({
  motion: "full" as "full" | "reduced",
}));
vi.mock("@/providers/settings", () => ({
  useSettings: () => ({ settings: preferences }),
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("创意画布动画活动范围", () => {
  const observations = new Map<Element, IntersectionObserverCallback>();
  const mediaListeners = new Set<() => void>();
  let visibility = "visible";
  let systemReduced = false;
  beforeEach(() => {
    preferences.motion = "full";
    visibility = "visible";
    systemReduced = false;
    observations.clear();
    mediaListeners.clear();
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility as DocumentVisibilityState,
    );
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return systemReduced;
      },
      addEventListener: (_name: string, listener: () => void) =>
        mediaListeners.add(listener),
      removeEventListener: (_name: string, listener: () => void) =>
        mediaListeners.delete(listener),
    }));
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private callback: IntersectionObserverCallback) {}
        observe(element: Element) {
          observations.set(element, this.callback);
        }
        disconnect() {
          for (const [element, callback] of observations)
            if (callback === this.callback) observations.delete(element);
        }
      },
    );
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function intersect(element: Element, visible: boolean) {
    act(() =>
      observations.get(element)!(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
  }

  it("实际艺术区域离屏时暂停，重返视口恢复，隐藏舞台即使仍有可见性记录也暂停", () => {
    const view = render(<ProjectStudio active />);
    const artwork = view.container.querySelector(".studio-art")!;
    expect(observations.has(artwork)).toBe(true);
    expect(artwork).toHaveAttribute("data-active", "true");
    intersect(artwork, false);
    expect(artwork).toHaveAttribute("data-active", "false");
    intersect(artwork, true);
    expect(artwork).toHaveAttribute("data-active", "true");
    view.rerender(<ProjectStudio active={false} />);
    expect(artwork).toHaveAttribute("data-active", "false");
    view.rerender(<ProjectStudio active />);
    expect(artwork).toHaveAttribute("data-active", "true");
    view.unmount();
    expect(observations.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
  });

  it("文档隐藏和两种减少动态偏好均停用可见艺术区域", () => {
    const view = render(<ProjectStudio active />);
    const artwork = view.container.querySelector(".studio-art")!;
    act(() => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(artwork).toHaveAttribute("data-active", "false");
    act(() => {
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(artwork).toHaveAttribute("data-active", "true");
    act(() => {
      systemReduced = true;
      mediaListeners.forEach((listener) => listener());
    });
    expect(artwork).toHaveAttribute("data-active", "false");
    act(() => {
      systemReduced = false;
      mediaListeners.forEach((listener) => listener());
    });
    preferences.motion = "reduced";
    view.rerender(<ProjectStudio active />);
    expect(artwork).toHaveAttribute("data-active", "false");
  });

  it("本地暂停保留表单交互与暂停偏好，减少动态时禁用播放控制", () => {
    const view = render(<ProjectStudio active />);
    const artwork = view.container.querySelector(".studio-art")!;
    const name = screen.getByLabelText("playground.name");
    fireEvent.click(
      screen.getByRole("button", { name: "playground.pauseMotion" }),
    );
    expect(artwork).toHaveAttribute("data-active", "false");
    fireEvent.change(name, { target: { value: "Paused draft" } });
    expect(screen.getByTestId("studio-preview-title")).toHaveTextContent(
      "Paused draft",
    );
    view.rerender(<ProjectStudio active={false} />);
    view.rerender(<ProjectStudio active />);
    expect(artwork).toHaveAttribute("data-active", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "playground.resumeMotion" }),
    );
    expect(artwork).toHaveAttribute("data-active", "true");
    preferences.motion = "reduced";
    view.rerender(<ProjectStudio active />);
    expect(
      screen.getByRole("button", { name: "playground.pauseMotion" }),
    ).toBeDisabled();
    expect(artwork).toHaveAttribute("data-active", "false");
  });
});

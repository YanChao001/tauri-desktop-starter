import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { animate } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollBounce } from "./use-scroll-bounce";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    // 仅控制第三方动画完成时机；曲线与指针停留场景另以真实浏览器验证。
    animate: vi.fn(
      (
        value: { jump(n: number): void },
        target: number | number[],
        options: { duration: number },
      ) => {
        if (Array.isArray(target)) value.jump(target[1]!);
        const timer = setTimeout(
          () => value.jump(Array.isArray(target) ? target.at(-1)! : target),
          options.duration * 1000,
        );
        return { stop: () => clearTimeout(timer) };
      },
    ),
  };
});

function geometry(
  element: HTMLElement,
  { height = 400, content = 1200, top = 0 } = {},
) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: content },
  });
  element.scrollTop = top;
  return element;
}

function mount(enabled = true) {
  const main = geometry(document.createElement("main"));
  const content = document.createElement("div");
  main.append(content);
  document.body.append(main);
  const ref = createRef<HTMLElement>();
  ref.current = main;
  const view = renderHook(
    ({ active, path }) => useScrollBounce(ref, active, path),
    { initialProps: { active: enabled, path: "/" } },
  );
  return { ...view, main, content };
}

function wheel(target: Element, deltaY: number, options: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY,
    ...options,
  });
  act(() => {
    target.dispatchEvent(event);
    vi.advanceTimersByTime(16);
  });
  return event;
}

function touch(
  target: Element,
  type: string,
  points: { identifier: number; clientX: number; clientY: number }[],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: points });
  act(() => {
    target.dispatchEvent(event);
    vi.advanceTimersByTime(16);
  });
  return event;
}

describe("内容区域边界回弹", () => {
  const visibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
    if (visibility)
      Object.defineProperty(document, "visibilityState", visibility);
    else Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("顶部与底部提供相反方向的实际 MotionValue 位移，不改写滚动位置和范围", () => {
    const { main, content, result } = mount();
    const changes: number[] = [];
    const stop = result.current.on("change", (value) => changes.push(value));
    const topInput = wheel(content, -120);
    expect(result.current.get()).toBeGreaterThan(5);
    expect(topInput.defaultPrevented).toBe(false);
    expect(main.scrollTop).toBe(0);
    expect(main.scrollHeight).toBe(1200);

    act(() => {
      main.scrollTop = 800;
      main.dispatchEvent(new Event("scroll"));
    });
    const bottomInput = wheel(content, 120);
    expect(result.current.get()).toBeLessThan(-5);
    expect(bottomInput.defaultPrevented).toBe(false);
    expect(main.scrollTop).toBe(800);
    expect(main.scrollHeight).toBe(1200);
    expect(changes.some((value) => value > 5)).toBe(true);
    expect(changes.some((value) => value < -5)).toBe(true);
    stop();
  });

  it("一轮连续滚轮只播放一次回弹，动画自行结束，不被后续输入延长", () => {
    const { content, result } = mount();
    wheel(content, -120);
    const first = result.current.get();
    for (let index = 0; index < 30; index++) wheel(content, -10000);
    expect(first).toBeGreaterThan(5);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(result.current.get()).toBe(0);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.get()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("中段、向内输入和程序化离开边界时保留原生滚动并复位反馈", () => {
    const { main, content, result } = mount();
    wheel(content, -120);
    expect(result.current.get()).toBeGreaterThan(0);
    wheel(content, 120);
    expect(result.current.get()).toBeGreaterThan(0);
    act(() => {
      main.scrollTop = 40;
      main.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.get()).toBe(0);
    main.scrollTop = 240;
    wheel(content, -120);
    expect(result.current.get()).toBe(0);
    expect(main.scrollTop).toBe(240);
    main.scrollTop = 0;
    wheel(content, -120);
    act(() => {
      main.scrollTop = 20;
      main.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.get()).toBe(0);
  });

  it("没有滚动条时仍可双向拉伸，不制造可滚动区域，滚动事件不清除底部反馈", () => {
    const { main, content, result } = mount();
    geometry(main, { height: 400, content: 400 });
    wheel(content, -120);
    expect(result.current.get()).toBeGreaterThan(5);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.get()).toBe(0);
    wheel(content, 120);
    expect(result.current.get()).toBeLessThan(-5);
    act(() => main.dispatchEvent(new Event("scroll")));
    expect(result.current.get()).toBeLessThan(-5);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.get()).toBe(0);
    expect(main.scrollHeight).toBe(main.clientHeight);
    expect(main.scrollTop).toBe(0);
  });

  it("同帧连续滚轮只触发一次动画，不增加排队动画", () => {
    const { content, result } = mount();
    const changes: number[] = [];
    const stop = result.current.on("change", (value) => changes.push(value));
    act(() => {
      for (let index = 0; index < 4; index++)
        content.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: -30 }),
        );
      vi.advanceTimersByTime(16);
    });
    const first = result.current.get();
    expect(first).toBeGreaterThan(5);
    expect(changes).toHaveLength(1);
    act(() => vi.advanceTimersByTime(16));
    expect(result.current.get()).toBe(first);
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.get()).toBeLessThan(1);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.get()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("指针留在内容区时，持续低幅尾流不会拖住回弹或反复把内容拉开", () => {
    const { content, result } = mount();
    wheel(content, -120);
    const positions: number[] = [];
    act(() => {
      for (let index = 0; index < 125; index++) {
        content.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: -4 }),
        );
        vi.advanceTimersByTime(8);
        positions.push(result.current.get());
      }
    });
    expect(positions[40]).toBeLessThan(1);
    expect(positions.slice(40).every((value) => value === 0)).toBe(true);
    act(() => vi.advanceTimersByTime(150));
    expect(vi.getTimerCount()).toBe(0);
    // 一轮结束后的新输入仍然可触发反馈。
    wheel(content, -4);
    expect(result.current.get()).toBeGreaterThan(0.5);
  });

  it("位移导致指针命中编辑控件时沿原轨迹回收，不瞬间清零或重新拉开", () => {
    const { content, result } = mount();
    const input = document.createElement("input");
    content.append(input);
    wheel(content, -120);
    const before = result.current.get();
    wheel(input, -120);
    expect(result.current.get()).toBeGreaterThan(0);
    expect(result.current.get()).toBeLessThanOrEqual(before);
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.get()).toBe(0);
  });

  it("停止输入后的复位轨迹不依赖指针是否离开内容区", () => {
    const staying = mount();
    const leaving = mount();
    act(() => {
      for (const item of [staying, leaving])
        item.content.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: -120 }),
        );
      vi.advanceTimersByTime(32);
      leaving.main.dispatchEvent(new MouseEvent("pointerleave"));
      for (let index = 0; index < 20; index++) {
        vi.advanceTimersByTime(16);
        expect(leaving.result.current.get()).toBe(staying.result.current.get());
      }
    });
    expect(staying.result.current.get()).toBe(0);
  });

  it("短页面持指保持拉伸，小幅反向先收回，越过原点后才翻向，抬手复位", () => {
    const { main, content, result } = mount();
    geometry(main, { height: 400, content: 400 });
    const point = { identifier: 1, clientX: 100, clientY: 100 };
    touch(content, "touchstart", [point]);
    touch(content, "touchmove", [{ ...point, clientY: 180 }]);
    const pulled = result.current.get();
    expect(pulled).toBeGreaterThan(5);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.get()).toBe(pulled);
    expect(vi.getTimerCount()).toBe(0);
    touch(content, "touchmove", [{ ...point, clientY: 160 }]);
    expect(result.current.get()).toBeGreaterThan(0);
    expect(result.current.get()).toBeLessThan(pulled);
    touch(content, "touchmove", [{ ...point, clientY: 60 }]);
    expect(result.current.get()).toBeLessThan(0);
    expect(main.scrollHeight).toBe(main.clientHeight);
    expect(main.scrollTop).toBe(0);
    touch(content, "touchend", []);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.get()).toBe(0);
  });

  it("支持按行或按页报告的滚轮，同时限制异常输入的幅度", () => {
    const { content, result } = mount();
    wheel(content, -3, { deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(result.current.get()).toBeGreaterThan(5);
    wheel(content, 120);
    wheel(content, -1, { deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(result.current.get()).toBeGreaterThan(5);
    expect(result.current.get()).toBeLessThanOrEqual(56);
  });

  it("内层滚动容器保留自己的手势，在其边界也不另外触发外层动画", () => {
    const { content, result } = mount();
    const nested = geometry(document.createElement("div"), {
      height: 100,
      content: 500,
      top: 100,
    });
    nested.style.overflowY = "auto";
    content.append(nested);
    wheel(nested, -120);
    expect(result.current.get()).toBe(0);
    nested.scrollTop = 0;
    wheel(nested, -120);
    expect(result.current.get()).toBe(0);
  });

  it.each(["contain", "none"])(
    "尊重内层 %s 边界隔离，即使内层没有溢出也不带动外层",
    (policy) => {
      const { content, result } = mount();
      const nested = geometry(document.createElement("div"), {
        height: 100,
        content: 100,
      });
      nested.style.overflowY = "auto";
      nested.style.overscrollBehaviorY = policy;
      content.append(nested);
      wheel(nested, -120);
      expect(result.current.get()).toBe(0);
    },
  );

  it.each([
    "<textarea></textarea>",
    '<input type="number">',
    "<select><option>选项</option></select>",
    '<div contenteditable="true"><span>可编辑文本</span></div>',
    '<div role="slider"></div>',
  ])("编辑控件保留自身行为：%s", (markup) => {
    const { content, result } = mount();
    content.innerHTML = markup;
    const target = content.querySelector("span") ?? content.firstElementChild!;
    wheel(target, -120);
    expect(result.current.get()).toBe(0);
  });

  it("文本选择、缩放、横向手势和按住鼠标键时不触发回弹", () => {
    const { content, result } = mount();
    content.textContent = "保留文本选择";
    const range = document.createRange();
    range.selectNodeContents(content);
    document.getSelection()?.addRange(range);
    wheel(content, -120);
    expect(result.current.get()).toBe(0);
    document.getSelection()?.removeAllRanges();
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { deltaX: 200 },
      { buttons: 1 },
    ]) {
      wheel(content, -120, options);
      expect(result.current.get()).toBe(0);
    }
  });

  it("等待外层委托处理结束，已被取消的输入不产生反馈", () => {
    const { main, content, result } = mount();
    const prevent = (event: Event) => event.preventDefault();
    document.body.addEventListener("wheel", prevent, { passive: false });
    try {
      const event = wheel(content, -120);
      expect(event.defaultPrevented).toBe(true);
      expect(result.current.get()).toBe(0);
      expect(main.scrollTop).toBe(0);
    } finally {
      document.body.removeEventListener("wheel", prevent);
    }
  });

  it("单指纵向边界拖动可拉伸，结束后归零，多指和横向手势不接管", () => {
    const { content, result } = mount();
    const point = { identifier: 1, clientX: 100, clientY: 100 };
    touch(content, "touchstart", [point]);
    const move = touch(content, "touchmove", [{ ...point, clientY: 160 }]);
    expect(result.current.get()).toBeGreaterThan(5);
    expect(move.defaultPrevented).toBe(false);
    touch(content, "touchend", []);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.get()).toBe(0);
    touch(content, "touchstart", [point]);
    touch(content, "touchmove", [{ ...point, clientX: 180, clientY: 110 }]);
    touch(content, "touchmove", [{ ...point, clientX: 180, clientY: 200 }]);
    expect(result.current.get()).toBe(0);
    touch(content, "touchstart", [point]);
    touch(content, "touchmove", [point, { ...point, identifier: 2 }]);
    expect(result.current.get()).toBe(0);
  });

  it("禁用、路由切换和页面隐藏立即停止并清除当前反馈", () => {
    const { content, result, rerender } = mount(false);
    wheel(content, -120);
    expect(result.current.get()).toBe(0);
    rerender({ active: true, path: "/" });
    wheel(content, -120);
    expect(result.current.get()).toBeGreaterThan(0);
    rerender({ active: true, path: "/settings" });
    expect(result.current.get()).toBe(0);
    wheel(content, -120);
    rerender({ active: false, path: "/settings" });
    expect(result.current.get()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ active: true, path: "/settings" });
    wheel(content, -120);
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.get()).toBe(0);
    wheel(content, -120);
    expect(result.current.get()).toBe(0);
  });

  it("卸载取消延迟反馈和回弹动画，遗留事件不再更新 MotionValue", () => {
    const { content, result, unmount } = mount();
    wheel(content, -120);
    act(() => vi.advanceTimersByTime(80));
    const value = result.current;
    unmount();
    expect(value.get()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    wheel(content, -120);
    expect(value.get()).toBe(0);

    const pending = mount();
    act(() => {
      pending.content.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -120 }),
      );
    });
    pending.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(pending.result.current.get()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

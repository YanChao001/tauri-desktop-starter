// 让 expect 支持 toBeInTheDocument 等 DOM 断言
import "@testing-library/jest-dom/vitest";

// jsdom 不实现滚动；让弹层的键盘聚焦路径仍能运行。
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= () => {};
  // Radix 的表单控件测量隐藏输入，jsdom 没有布局观察器。
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

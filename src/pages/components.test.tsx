import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ResourceLibrary } from "@/components/showcase/resource-library";
import { ControlStates } from "@/components/showcase/control-states";
import Components from "./components";

const notifications = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({
    t: (key: string, variables?: Record<string, string | number>) =>
      variables ? `${key} ${Object.values(variables).join(" ")}` : key,
  }),
}));
vi.mock("@/hooks/use-demo-motion", () => ({
  useDemoMotion: () => ({ active: false, visible: true, reduced: true }),
}));

function renderPlayground() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Components />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("交互组件舞台", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("PointerEvent", MouseEvent);
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("控件状态展示保留校验输入，支持只读与部分选择的键盘操作", async () => {
    const user = userEvent.setup();
    render(<ControlStates />);
    const notes = screen.getByRole("textbox", { name: "playground.notes" });
    await user.type(notes, "Keep this draft");
    await user.click(
      screen.getByRole("button", { name: "playground.validate" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "playground.titleRequired",
    );
    expect(notes).toHaveValue("Keep this draft");
    await user.type(
      screen.getByRole("textbox", { name: "playground.requiredTitle" }),
      "Review",
    );
    await user.click(
      screen.getByRole("button", { name: "playground.validate" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(notifications.success).toHaveBeenCalledWith("playground.validated");
    expect(screen.queryByText("playground.validated")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "playground.readOnly" }),
    ).toHaveAttribute("readonly");
    expect(
      screen.getByRole("textbox", { name: "playground.disabled" }),
    ).toBeDisabled();
    const all = screen.getByRole("checkbox", { name: "playground.selectAll" });
    expect(all).toBePartiallyChecked();
    all.focus();
    await user.keyboard(" ");
    expect(all).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "playground.optionCode" }),
    ).toBeChecked();
    await user.keyboard(" ");
    expect(
      screen.getByRole("checkbox", { name: "playground.optionDesign" }),
    ).not.toBeChecked();
  });

  it("资料错误重试保留筛选与收藏，并恢复加载结果", () => {
    vi.useFakeTimers();
    render(<ResourceLibrary active />);
    const search = screen.getByRole("textbox", { name: "playground.search" });
    fireEvent.change(search, { target: { value: "prismTitle" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "playground.favoritesOnly" }),
    );
    const resource = screen.getByText("playground.prismTitle");
    const content = resource.closest(".library-content");
    fireEvent.click(
      screen.getByRole("button", { name: "playground.tryError" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "playground.errorTitle",
    );
    expect(resource.closest(".library-content")).toBe(content);
    expect(content).toHaveAttribute("inert");
    expect(
      screen.queryByRole("button", { name: /playground.prismTitle/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "playground.retry" }));
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(resource.closest(".library-content")).toBe(content);
    expect(content).toHaveAttribute("inert");
    act(() => vi.advanceTimersByTime(750));
    expect(screen.getByText("playground.prismTitle")).toBeVisible();
    expect(content).not.toHaveAttribute("inert");
    expect(search).toHaveValue("prismTitle");
    expect(
      screen.getByRole("checkbox", { name: "playground.favoritesOnly" }),
    ).toBeChecked();
    expect(screen.getByText("playground.resultCount 1")).toBeVisible();
  });

  it("输入、滑块、署名和配色联动预览，切换舞台保留修改，重置恢复初始状态", async () => {
    const user = userEvent.setup();
    renderPlayground();
    const name = screen.getByRole("textbox", { name: "playground.name" });
    await user.type(name, "Lunar studio");
    expect(screen.getByTestId("studio-preview-title")).toHaveTextContent(
      "Lunar studio",
    );
    const energy = screen.getByRole("slider", { name: "playground.energy" });
    fireEvent.keyDown(energy, { key: "ArrowRight" });
    expect(energy).toHaveAttribute("aria-valuenow", "65");
    expect(
      screen.getByRole("status", { name: "playground.energy" }),
    ).toHaveTextContent("65");
    await user.click(screen.getByRole("switch", { name: "playground.glow" }));
    expect(document.querySelector(".studio-canvas")).toHaveAttribute(
      "data-glow",
      "false",
    );
    await user.click(
      screen.getByRole("checkbox", { name: "playground.showAuthor" }),
    );
    expect(screen.queryByText("playground.author")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("radio", { name: "playground.colorCyan" }),
    );
    expect(document.querySelector(".studio-canvas")).toHaveAttribute(
      "data-palette",
      "cyan",
    );
    await user.click(screen.getByRole("tab", { name: /playground.feedback/ }));
    expect(name).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: /playground.inputs/ }));
    expect(name).toHaveValue("Lunar studio");
    await user.click(screen.getByRole("button", { name: "playground.reset" }));
    expect(name).toHaveValue("");
    expect(energy).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByTestId("studio-preview-title")).toHaveTextContent(
      "playground.defaultName",
    );
    expect(
      screen.getByRole("checkbox", { name: "playground.showAuthor" }),
    ).toBeChecked();
  });

  it("动效与控件共用标签，切换保留输入和动效场景", async () => {
    const user = userEvent.setup();
    renderPlayground();
    const name = screen.getByRole("textbox", { name: "playground.name" });
    await user.type(name, "Keep this project");
    await user.click(screen.getByRole("tab", { name: /nav.motion/ }));
    await act(async () => vi.dynamicImportSettled());
    await screen.findByRole("tab", { name: "lab.layout" });
    await user.click(screen.getByRole("tab", { name: "lab.layout" }));
    await user.click(screen.getByRole("tab", { name: /playground.inputs/ }));
    expect(name).toBeVisible();
    expect(name).toHaveValue("Keep this project");
    await user.click(screen.getByRole("tab", { name: /nav.motion/ }));
    expect(screen.getByRole("tab", { name: "lab.layout" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("重组真实改变画布类型/构图/能量，配置浮层展示当前值", async () => {
    const user = userEvent.setup();
    renderPlayground();
    await user.click(screen.getByRole("button", { name: "playground.remix" }));
    expect(document.querySelector(".studio-canvas")).toHaveAttribute(
      "data-palette",
      "cyan",
    );
    expect(document.querySelector(".studio-canvas")).toHaveAttribute(
      "data-composition",
      "bold",
    );
    expect(
      screen.getByRole("slider", { name: "playground.energy" }),
    ).toHaveAttribute("aria-valuenow", "89");
    await user.click(
      screen.getByRole("button", { name: "playground.inspect" }),
    );
    const configuration = screen.getByRole("dialog");
    expect(configuration).toHaveTextContent('"kind": "product"');
    expect(configuration).toHaveTextContent('"energy": 89');
  });

  it("协作者表单校验邮箱与重复项，取消不添加，确认只改本页列表", async () => {
    const user = userEvent.setup();
    renderPlayground();
    await user.click(screen.getByRole("tab", { name: /playground.feedback/ }));
    await user.click(
      screen.getByRole("button", { name: "playground.addCollaborator" }),
    );
    await user.click(
      screen.getByRole("button", { name: "playground.addMember" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "playground.invalidEmail",
    );
    const email = screen.getByRole("textbox", { name: "playground.email" });
    await user.type(email, "MIKA@example.com");
    await user.click(
      screen.getByRole("button", { name: "playground.addMember" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "playground.duplicateEmail",
    );
    await user.clear(email);
    await user.type(email, "new@example.com");
    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByText("new@example.com")).not.toBeInTheDocument();
    expect(notifications.success).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "playground.addCollaborator" }),
    );
    await user.click(
      screen.getByRole("button", { name: "playground.addMember" }),
    );
    expect(screen.getByText("new@example.com")).toBeVisible();
    expect(screen.getByText("playground.memberCount 3")).toBeVisible();
    expect(notifications.success).toHaveBeenCalledExactlyOnceWith(
      "playground.memberAdded",
    );
  });

  it("通知使用用户消息和所选语气，偏好开关控制详细说明", async () => {
    const user = userEvent.setup();
    renderPlayground();
    await user.click(screen.getByRole("tab", { name: /playground.feedback/ }));
    await user.type(
      screen.getByRole("textbox", { name: "playground.message" }),
      "Hello canvas",
    );
    await user.click(
      screen.getByRole("button", {
        name: "playground.notificationPreferences",
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "playground.tone" }));
    await user.click(
      screen.getByRole("option", { name: "playground.toneError" }),
    );
    await user.click(
      screen.getByRole("switch", { name: "playground.detailedNotification" }),
    );
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "playground.sendNotification" }),
    );
    expect(notifications.error).toHaveBeenCalledExactlyOnceWith(
      "Hello canvas",
      { description: undefined },
    );
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("成员菜单真正改变角色并移除指定协作者", async () => {
    const user = userEvent.setup();
    renderPlayground();
    await user.click(screen.getByRole("tab", { name: /playground.feedback/ }));
    const menu = () =>
      screen.getByRole("button", {
        name: "playground.memberActions mika@example.com",
      });
    await user.click(menu());
    await user.click(
      screen.getByRole("menuitem", { name: "playground.roleViewer" }),
    );
    const member = screen
      .getByText("mika@example.com")
      .closest(".feedback-member")!;
    expect(
      within(member as HTMLElement).getByText("playground.roleViewer"),
    ).toBeVisible();
    await user.click(menu());
    await user.click(
      screen.getByRole("menuitem", { name: "playground.removeMember" }),
    );
    expect(screen.queryByText("mika@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("jules@example.com")).toBeVisible();
    expect(screen.getByText("playground.memberCount 1")).toBeVisible();
    expect(notifications.info).toHaveBeenCalledWith("playground.memberRemoved");
  });

  it("资料搜索与收藏联动，布局切换保留筛选，空状态可以清除筛选", async () => {
    const user = userEvent.setup();
    renderPlayground();
    await user.click(screen.getByRole("tab", { name: /playground.data/ }));
    const search = screen.getByRole("textbox", { name: "playground.search" });
    await user.type(search, "orbitTitle");
    expect(screen.getByText("playground.resultCount 1")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /playground.orbitTitle playground.orbitDescription/,
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "playground.favorite playground.orbitTitle",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "playground.favoritesOnly" }),
    );
    await user.click(screen.getByRole("radio", { name: "playground.list" }));
    expect(
      within(screen.getByRole("table")).getByText("playground.orbitTitle"),
    ).toBeVisible();
    expect(search).toHaveValue("orbitTitle");
    await user.click(
      screen.getByRole("button", {
        name: "playground.unfavorite playground.orbitTitle",
      }),
    );
    expect(screen.getByText("playground.emptyTitle")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "playground.clearFilters" }),
    );
    expect(search).toHaveValue("");
    expect(screen.getByText("playground.resultCount 6")).toBeVisible();
    expect(screen.getAllByRole("row")).toHaveLength(7);
  });

  it("分类筛选与详情收藏作用于同一份资料状态", async () => {
    const user = userEvent.setup();
    renderPlayground();
    await user.click(screen.getByRole("tab", { name: /playground.data/ }));
    await user.click(
      screen.getByRole("combobox", { name: "playground.category" }),
    );
    await user.click(
      screen.getByRole("option", { name: "playground.categoryCode" }),
    );
    expect(screen.getByText("playground.resultCount 2")).toBeVisible();
    expect(screen.queryByText("playground.prismTitle")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /playground.atlasTitle playground.atlasDescription/,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "playground.atlasTitle" }),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "playground.addFavorite" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "playground.removeFavorite" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("checkbox", { name: "playground.favoritesOnly" }),
    );
    expect(screen.getByText("playground.resultCount 1")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "playground.unfavorite playground.atlasTitle",
      }),
    ).toBeVisible();
  });

  it("加载体验有真实进度、支持取消与再次完成，卸载清理计时器", () => {
    vi.useFakeTimers();
    const view = render(<ResourceLibrary active />);
    fireEvent.click(
      screen.getByRole("button", { name: "playground.tryLoading" }),
    );
    act(() => vi.advanceTimersByTime(300));
    expect(
      screen.getByRole("progressbar", { name: "playground.loading" }),
    ).toHaveAttribute("aria-valuenow", "40");
    fireEvent.click(
      screen.getByRole("button", { name: "playground.cancelLoading" }),
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "playground.tryLoading" }),
    );
    act(() => vi.advanceTimersByTime(750));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("playground.prismTitle")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "playground.tryLoading" }),
    );
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

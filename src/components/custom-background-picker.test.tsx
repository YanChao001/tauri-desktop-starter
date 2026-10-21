import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  importBackgroundImage,
  type CustomBackground,
} from "@/lib/background-image";
import type { Background } from "@/lib/backgrounds";
import { CustomBackgroundPicker } from "./custom-background-picker";

const state = vi.hoisted(() => ({
  settings: { background: "plain", customBackground: null } as {
    background: Background;
    customBackground: CustomBackground | null;
  },
  update: vi.fn(),
}));
vi.mock("@/providers/settings", () => ({ useSettings: () => state }));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/background-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/background-image")>()),
  importBackgroundImage: vi.fn(),
}));
const image: CustomBackground = {
  name: "sky.webp",
  dataUrl: "data:image/webp;base64," + btoa("RIFF0000WEBP"),
  fit: "cover",
};
const file = () => new File(["png fixture"], "sky.png", { type: "image/png" });
function choose() {
  fireEvent.change(screen.getByLabelText("settings.importBackground"), {
    target: { files: [file()] },
  });
}
beforeEach(() => {
  state.settings = { background: "plain", customBackground: null };
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("自定义背景导入", () => {
  it("成功解码后同时应用图片与皮肤选择", async () => {
    vi.mocked(importBackgroundImage).mockResolvedValue(image);
    render(<CustomBackgroundPicker />);
    choose();
    expect(
      await screen.findByRole("button", { name: "settings.importBackground" }),
    ).toBeEnabled();
    expect(state.update).toHaveBeenCalledWith({
      background: "custom",
      customBackground: image,
    });
  });
  it("导入失败保留此前图片，允许重试", async () => {
    state.settings = { background: "custom", customBackground: image };
    vi.mocked(importBackgroundImage).mockRejectedValue(new Error("broken"));
    render(<CustomBackgroundPicker />);
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings.imageDecodeError",
    );
    expect(screen.getByText("sky.webp")).toBeVisible();
    expect(state.update).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "settings.replaceBackground" }),
    ).toBeEnabled();
  });
  it("组件卸载或期间切换背景后，不应用晚到的导入结果", async () => {
    let complete!: (image: CustomBackground) => void;
    vi.mocked(importBackgroundImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<CustomBackgroundPicker />);
    choose();
    state.settings = { background: "dune", customBackground: null };
    view.rerender(<CustomBackgroundPicker />);
    await act(async () => complete(image));
    expect(state.update).not.toHaveBeenCalled();
    choose();
    view.unmount();
    await act(async () => complete(image));
    expect(state.update).not.toHaveBeenCalled();
  });
  it("移除当前图片时恢复纯色，内置皮肤选中时仅清除图片副本", () => {
    state.settings = { background: "custom", customBackground: image };
    const view = render(<CustomBackgroundPicker />);
    fireEvent.click(
      screen.getByRole("button", { name: "settings.removeBackground" }),
    );
    expect(state.update).toHaveBeenLastCalledWith({
      background: "plain",
      customBackground: null,
    });
    state.settings = { background: "aurora", customBackground: image };
    view.rerender(<CustomBackgroundPicker />);
    fireEvent.click(
      screen.getByRole("button", { name: "settings.removeBackground" }),
    );
    expect(state.update).toHaveBeenLastCalledWith({ customBackground: null });
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPersistence } from "./settings-persistence";

const state = vi.hoisted(() => ({
  persistence: "saved",
  persistenceError: null as string | null,
  retrySave: vi.fn(),
}));
vi.mock("@/providers/settings", () => ({ useSettings: () => state }));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("设置保存反馈", () => {
  it("成功后保持安静，保存中仅向辅助技术提供状态", () => {
    state.persistence = "saved";
    const { container, rerender } = render(<SettingsPersistence />);
    expect(container).toBeEmptyDOMElement();
    state.persistence = "saving";
    rerender(<SettingsPersistence />);
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.queryByText("settings.persistenceSaved")).toBeNull();
  });
  it("保存失败仍保留重试，未来版本拒写时给出说明", () => {
    state.persistence = "error";
    state.persistenceError = "STORAGE_UNAVAILABLE";
    const { rerender } = render(<SettingsPersistence />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings.persistenceError",
    );
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(state.retrySave).toHaveBeenCalledOnce();
    state.persistenceError = "FUTURE_SETTINGS_VERSION";
    rerender(<SettingsPersistence />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings.persistenceFuture",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

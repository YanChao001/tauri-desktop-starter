import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionInfo } from "@/lib/tauri";
import { ExtensionData } from "./extension-data";
import { createExtensionSession } from "./extension-session-cache";

vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});

afterEach(cleanup);

it("associates the visible UTF-8 limit error with host data and preserves the input for correction", () => {
  const item: ExtensionInfo = {
    generation: 1,
    origin: { kind: "local" },
    enabled: true,
    grantedPermissions: ["text:read"],
    package: {
      sha256: "a".repeat(64),
      bytes: 100,
      manifest: {
        id: "test.data",
        formatVersion: 3,
        apiVersion: 2,
        minHostVersion: "0.1.0",
        version: "1.0.0",
        name: "Host data",
        author: "Test",
        description: "Test",
        commands: [],
        permissions: ["text:read"],
        optionalPermissions: [],
        network: [],
      },
    },
  };
  const session = createExtensionSession("test");
  const onSend = vi.fn();
  render(
    <ExtensionData
      item={item}
      session={session}
      blocked={false}
      open
      onOpenChange={vi.fn()}
      onSend={onSend}
    />,
  );
  const input = screen.getByLabelText("Input text");
  const oversized = "汉".repeat(Math.ceil((1024 * 1024) / 3));
  fireEvent.change(input, { target: { value: oversized } });
  const error = screen.getByRole("alert");
  expect(error).toBeVisible();
  expect(input).toHaveAttribute("aria-describedby", error.id);
  expect(input).toHaveValue(oversized);
  expect(
    screen.getByRole("button", { name: "Send selected data" }),
  ).toBeDisabled();
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Corrected input" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(input).not.toHaveAttribute("aria-describedby");
  fireEvent.click(screen.getByRole("button", { name: "Send selected data" }));
  expect(onSend).toHaveBeenCalledWith({
    inputText: "Corrected input",
    fileIds: [],
    url: null,
  });
});

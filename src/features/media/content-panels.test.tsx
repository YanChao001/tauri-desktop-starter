import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { MediaPreview, SafeMarkdown } from "./content-panels";

vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ language: "en", t: createTranslator(en) }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders GFM content without executing raw HTML, unsafe links or external images", () => {
  const { container } = render(
    <SafeMarkdown
      content={
        "# Safe\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![tracker](https://example.test/pixel)\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Safe" })).toBeVisible();
  expect(screen.getByRole("table")).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "Completed Markdown task" }),
  ).toBeChecked();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "unsafe" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/External image blocked/)).toBeVisible();
});

it("keeps the current preview after an invalid file and revokes local URLs on replace and unmount", () => {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:one")
    .mockReturnValueOnce("blob:two");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const { unmount } = render(<MediaPreview />);
  const input = screen.getByLabelText("Choose image, audio or video");
  fireEvent.change(input, {
    target: { files: [new File(["first"], "one.png", { type: "image/png" })] },
  });
  expect(screen.getByRole("img", { name: "one.png" })).toHaveAttribute(
    "src",
    "blob:one",
  );
  fireEvent.change(input, {
    target: {
      files: [new File(["not-media"], "private.txt", { type: "text/plain" })],
    },
  });
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("img", { name: "one.png" })).toHaveAttribute(
    "src",
    "blob:one",
  );
  expect(create).toHaveBeenCalledOnce();
  fireEvent.change(input, {
    target: { files: [new File(["second"], "two.png", { type: "image/png" })] },
  });
  expect(revoke).toHaveBeenCalledWith("blob:one");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:two");
});

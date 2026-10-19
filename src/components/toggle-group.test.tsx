import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

describe("ToggleGroup", () => {
  afterEach(cleanup);

  it("垂直组按上下方向键移动焦点", async () => {
    render(
      <ToggleGroup type="single" orientation="vertical" aria-label="Layout">
        <ToggleGroupItem value="one">One</ToggleGroupItem>
        <ToggleGroupItem value="two">Two</ToggleGroupItem>
      </ToggleGroup>,
    );
    const first = screen.getByRole("radio", { name: "One" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Two" })).toHaveFocus(),
    );
  });
});

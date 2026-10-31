import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

afterEach(cleanup);

it("竖向页签声明方向并按上下方向键移动焦点", async () => {
  const user = userEvent.setup();
  render(
    <Tabs orientation="vertical" defaultValue="one">
      <TabsList aria-label="Views">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  screen.getByRole("tab", { name: "One" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
  expect(screen.getByRole("tablist", { name: "Views" })).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );
});

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import Motion from "./motion";

function Destination() {
  const { pathname, search, hash } = useLocation();
  return (
    <output>
      {pathname}
      {search}
      {hash}
    </output>
  );
}
afterEach(cleanup);
it("原动效链接定位到交互页，保留导览与其他查询参数", () => {
  render(
    <MemoryRouter
      initialEntries={["/motion?journey=interface&step=3&other=keep#spring"]}
    >
      <Routes>
        <Route path="/motion" element={<Motion />} />
        <Route path="/components" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "/components?journey=interface&step=3&other=keep&stage=motion#spring",
  );
});

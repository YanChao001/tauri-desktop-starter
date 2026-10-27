import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import Updates from "./updates";

function Destination() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>
        {pathname}
        {search}
      </output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
afterEach(cleanup);
it("replaces old update links with the settings section while retaining a specific focus and other parameters", async () => {
  render(
    <MemoryRouter
      initialEntries={[
        "/catalog",
        "/updates?focus=autoUpdates&keep=1&section=old",
      ]}
    >
      <Routes>
        <Route path="/updates" element={<Updates />} />
        <Route path="/settings" element={<Destination />} />
        <Route path="/catalog" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(
      "/settings?focus=autoUpdates&keep=1&section=updates",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("/catalog")).toBeInTheDocument();
});

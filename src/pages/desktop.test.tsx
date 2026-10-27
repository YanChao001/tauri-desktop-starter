import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import Desktop from "./desktop";

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
it("replaces old desktop links with settings while preserving focus and other query parameters", async () => {
  render(
    <MemoryRouter
      initialEntries={[
        "/catalog",
        "/desktop?focus=background&keep=1&section=old",
      ]}
    >
      <Routes>
        <Route path="/desktop" element={<Desktop />} />
        <Route path="/settings" element={<Destination />} />
        <Route path="/catalog" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(
      "/settings?focus=background&keep=1&section=desktop",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("/catalog")).toBeInTheDocument();
});

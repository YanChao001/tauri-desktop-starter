import { describe, expect, it } from "vitest";
import { APP_ROUTES, NAVIGATION_GROUPS, matchRoute } from "./routes";

describe("application information architecture", () => {
  it("keeps the same unique URLs and groups them in presentation order", () => {
    expect(NAVIGATION_GROUPS.map(({ id }) => id)).toEqual([
      "experience",
      "capabilities",
      "system",
    ]);
    expect(
      NAVIGATION_GROUPS.map(({ id }) =>
        APP_ROUTES.filter((route) => route.group === id).map(
          ({ path }) => path,
        ),
      ),
    ).toEqual([
      ["/", "/components", "/motion"],
      ["/desktop", "/database", "/bridge"],
      ["/diagnostics", "/updates", "/settings"],
    ]);
    expect(new Set(APP_ROUTES.map(({ path }) => path)).size).toBe(9);
    expect(
      APP_ROUTES.filter(({ index }) => index).map(({ path }) => path),
    ).toEqual(["/"]);
  });

  it("preserves the demo-only policy without hiding desktop or system capabilities", () => {
    expect(
      APP_ROUTES.filter(({ demoOnly }) => demoOnly)
        .map(({ path }) => path)
        .sort(),
    ).toEqual(["/bridge", "/components", "/motion"]);
    expect(
      APP_ROUTES.filter(({ demoOnly }) => !demoOnly).map(({ path }) => path),
    ).toEqual([
      "/",
      "/desktop",
      "/database",
      "/diagnostics",
      "/updates",
      "/settings",
    ]);
  });

  it("matches nested paths by segment and falls back for unknown paths", () => {
    expect(matchRoute("/settings/appearance").path).toBe("/settings");
    expect(matchRoute("/desktop").group).toBe("capabilities");
    expect(matchRoute("/desktop-tools").path).toBe("/");
    expect(matchRoute("/unknown").path).toBe("/");
  });
});

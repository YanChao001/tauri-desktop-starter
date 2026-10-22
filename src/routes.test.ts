// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APP_ROUTES, matchRoute } from "./routes";

describe("路由配置与匹配", () => {
  it("路径唯一且首页唯一", () => {
    expect(new Set(APP_ROUTES.map(({ path }) => path)).size).toBe(
      APP_ROUTES.length,
    );
    expect(
      APP_ROUTES.filter(({ index }) => index).map(({ path }) => path),
    ).toEqual(["/"]);
  });

  it("按路径段匹配子页面，未知路径返回首页", () => {
    expect(matchRoute("/settings/appearance").path).toBe("/settings");
    expect(matchRoute("/desktop").group).toBe("capabilities");
    expect(matchRoute("/desktop-tools").path).toBe("/");
    expect(matchRoute("/unknown").path).toBe("/");
  });
});

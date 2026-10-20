// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APP_ROUTES, NAVIGATION_GROUPS, matchRoute } from "./routes";

describe("路由配置与匹配", () => {
  it("路径唯一、首页唯一，各路由引用已声明的导航分组", () => {
    expect(new Set(APP_ROUTES.map(({ path }) => path)).size).toBe(
      APP_ROUTES.length,
    );
    expect(
      APP_ROUTES.filter(({ index }) => index).map(({ path }) => path),
    ).toEqual(["/"]);
    const groups = new Set<string>(NAVIGATION_GROUPS.map(({ id }) => id));
    expect(APP_ROUTES.every(({ group }) => groups.has(group))).toBe(true);
  });

  it("按路径段匹配子页面，未知路径返回首页", () => {
    expect(matchRoute("/settings/appearance").path).toBe("/settings");
    expect(matchRoute("/desktop").group).toBe("capabilities");
    expect(matchRoute("/desktop-tools").path).toBe("/");
    expect(matchRoute("/unknown").path).toBe("/");
  });
});

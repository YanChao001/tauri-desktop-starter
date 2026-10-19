import { describe, expect, it } from "vitest";

import { APP_ROUTES, matchRoute } from "@/routes";

describe("matchRoute", () => {
  it("首页只匹配根路径，不会被其他路径抢走", () => {
    expect(matchRoute("/").path).toBe("/");
    expect(matchRoute("/bridge").path).toBe("/bridge");
  });

  it("子路径归属到最近的父级路由", () => {
    expect(matchRoute("/settings/general").path).toBe("/settings");
  });

  it("未知路径回落到首页，顶栏不会空着", () => {
    expect(matchRoute("/not-exist").path).toBe("/");
  });
});

describe("APP_ROUTES", () => {
  it("路径不重复", () => {
    const paths = APP_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("只有一个 index 路由", () => {
    expect(APP_ROUTES.filter((route) => route.index)).toHaveLength(1);
  });
});

// @vitest-environment node
import { expect, it } from "vitest";
import { APP_ROUTES } from "@/routes";
import { capabilityFor, pageSource, repositoryFileUrl } from "./model";

it("describes every registered page without inventing a second route list", () => {
  for (const route of APP_ROUTES) {
    expect(capabilityFor(route.path).kinds, route.path).not.toContain(
      "inspect",
    );
    expect(pageSource(route.path)).toMatch(/^src\/pages\/[a-z-]+\.tsx$/);
  }
});

it("distinguishes local fixtures from native or externally configured capabilities", () => {
  expect(capabilityFor("/data-studio").kinds).toEqual(["local"]);
  expect(capabilityFor("/database").kinds).toEqual(["native"]);
  expect(capabilityFor("/network").kinds).toEqual([
    "local",
    "native",
    "external",
  ]);
  expect(capabilityFor("/unknown").kinds).toEqual(["inspect"]);
  expect(
    repositoryFileUrl("https://github.com/acme/app.git", "docs/README.md", {
      defaultBranch: "develop",
      links: { file: "{repositoryUrl}/blob/{ref}/{path}" },
    }),
  ).toBe("https://github.com/acme/app/blob/develop/docs/README.md");
});

it("uses the configured source layout and branch for documentation links", () => {
  expect(
    repositoryFileUrl(
      "https://code.example/acme/desk.git/",
      "docs/getting started.md#setup",
      {
        defaultBranch: "release/docs",
        links: { file: "{repositoryUrl}/-/blob/{ref}/{path}" },
      },
    ),
  ).toBe(
    "https://code.example/acme/desk/-/blob/release%2Fdocs/docs/getting%20started.md#setup",
  );
});

import { expect, it } from "vitest";
import type {
  ExtensionInfo,
  ExtensionOrigin,
  ExtensionPreview,
} from "@/lib/tauri";
import { canUpdateWithoutReview } from "./extension-upgrade-policy";

const preview: ExtensionPreview = {
  manifest: {
    formatVersion: 3,
    apiVersion: 2,
    minHostVersion: "0.1.0",
    id: "test.example",
    version: "1.0.0",
    name: "Example",
    author: "Example author",
    description: "Example extension",
    commands: [],
    permissions: ["text:read", "network:https"],
    optionalPermissions: ["storage", "files:read"],
    network: [
      { origin: "https://example.com", methods: ["GET", "POST"] },
      { origin: "https://example.net", methods: ["HEAD"] },
    ],
  },
  sha256: "a".repeat(64),
  bytes: 100,
};
const market: ExtensionOrigin = {
  kind: "market",
  source: {
    repository: "owner/market",
    publicKeyFingerprint: "b".repeat(64),
    catalogRevision: 1,
    packageSha256: "c".repeat(64),
  },
};
function installed(
  origin: ExtensionOrigin = { kind: "bundled" },
): ExtensionInfo {
  return {
    package: preview,
    origin,
    generation: 2,
    enabled: false,
    grantedPermissions: [],
  };
}
const upgrade: ExtensionPreview = {
  ...preview,
  sha256: "d".repeat(64),
  manifest: { ...preview.manifest, version: "2.1.0" },
};

it("同来源跨主版本升级允许复用授权，权限与网络声明顺序不影响结果", () => {
  const reordered: ExtensionPreview = {
    ...upgrade,
    manifest: {
      ...upgrade.manifest,
      permissions: [...preview.manifest.permissions].reverse(),
      optionalPermissions: [...preview.manifest.optionalPermissions].reverse(),
      network: [...preview.manifest.network].reverse().map((rule) => ({
        ...rule,
        methods: [...rule.methods].reverse(),
      })),
    },
  };
  expect(
    canUpdateWithoutReview(installed(), reordered, { kind: "bundled" }),
  ).toBe(true);
  expect(
    canUpdateWithoutReview(installed(market), reordered, {
      kind: "market",
      source: {
        ...market.source,
        catalogRevision: 8,
        packageSha256: "e".repeat(64),
      },
    }),
  ).toBe(true);
});

it("首次安装、本地来源和市场仓库或密钥变更均要求审阅", () => {
  expect(canUpdateWithoutReview(undefined, upgrade, market)).toBe(false);
  expect(
    canUpdateWithoutReview(installed({ kind: "local" }), upgrade, {
      kind: "local",
    }),
  ).toBe(false);
  expect(canUpdateWithoutReview(installed(), upgrade, market)).toBe(false);
  expect(
    canUpdateWithoutReview(installed(market), upgrade, { kind: "bundled" }),
  ).toBe(false);
  for (const source of [
    { ...market.source, repository: "different/market" },
    { ...market.source, publicKeyFingerprint: "f".repeat(64) },
  ])
    expect(
      canUpdateWithoutReview(installed(market), upgrade, {
        kind: "market",
        source,
      }),
    ).toBe(false);
});

it("权限新增、移除、从可选提升为必需以及网络授权变化均要求审阅", () => {
  const changes = [
    {
      permissions: [...preview.manifest.permissions, "window:control" as const],
    },
    { permissions: ["text:read" as const] },
    { optionalPermissions: ["storage" as const] },
    {
      optionalPermissions: [
        ...preview.manifest.optionalPermissions,
        "links:open" as const,
      ],
    },
    {
      permissions: [...preview.manifest.permissions, "storage" as const],
      optionalPermissions: ["files:read" as const],
    },
    { network: [{ origin: "https://example.org", methods: ["GET", "POST"] }] },
    {
      network: preview.manifest.network.map((rule) => ({
        ...rule,
        methods: ["GET"],
      })),
    },
  ];
  for (const change of changes)
    expect(
      canUpdateWithoutReview(
        installed(),
        {
          ...upgrade,
          manifest: { ...upgrade.manifest, ...change },
        },
        { kind: "bundled" },
      ),
    ).toBe(false);
});

it("相同版本、降级、无效版本或不同插件不能跳过审阅", () => {
  for (const version of ["1.0.0", "0.9.0", "invalid"])
    expect(
      canUpdateWithoutReview(
        installed(),
        {
          ...upgrade,
          manifest: { ...upgrade.manifest, version },
        },
        { kind: "bundled" },
      ),
    ).toBe(false);
  expect(
    canUpdateWithoutReview(
      installed(),
      {
        ...upgrade,
        manifest: { ...upgrade.manifest, id: "different.example" },
      },
      { kind: "bundled" },
    ),
  ).toBe(false);
});

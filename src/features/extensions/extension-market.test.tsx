import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import * as native from "@/lib/tauri";
import { ExtensionMarket } from "./extension-market";
import { useExtensionMarket } from "./use-extension-market";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: vi.fn(() => true),
  extensionMarketSnapshot: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});

const entry: native.MarketEntry = {
  package: {
    bytes: 100,
    sha256: "a".repeat(64),
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "example.word-lab",
      version: "2.0.0",
      name: "Word Lab",
      author: "Example",
      description: "Offline text tools",
      commands: [],
      permissions: [],
      optionalPermissions: [],
      network: [],
    },
  },
  category: "text",
  featured: true,
  releaseTag: "market-1",
  asset: "word-lab.starter-extension.json",
  packageSha256: "b".repeat(64),
  packageBytes: 200,
};
const snapshot: native.MarketSnapshot = {
  catalog: {
    schemaVersion: 2,
    revision: 10,
    repository: "example/market",
    issuedAt: 1_792_800_000,
    expiresAt: 1_793_400_000,
    entries: [entry],
  },
  fetchedAt: 1_792_800_010,
  stale: false,
};
const emptySnapshot: native.MarketSnapshot = {
  ...snapshot,
  catalog: { ...snapshot.catalog, entries: [] },
};

function Market({
  data = null,
  error = null,
  loading = false,
}: {
  data?: native.MarketSnapshot | null;
  error?: unknown;
  loading?: boolean;
}) {
  return (
    <ExtensionMarket
      snapshot={data}
      error={error}
      loading={loading}
      busy={false}
      downloadingId={null}
      installed={[]}
      onRefresh={vi.fn()}
      onDownload={vi.fn()}
    />
  );
}

function LiveMarket() {
  const market = useExtensionMarket();
  return (
    <ExtensionMarket
      snapshot={market.data}
      error={market.error}
      loading={market.loading}
      busy={false}
      downloadingId={null}
      installed={[]}
      onRefresh={() => void market.reload()}
      onDownload={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

it.each([
  ["MARKET_INCOMPATIBLE", "ext.market.incompatible"],
  ["MARKET_EXPIRED", "ext.market.expired"],
  ["MARKET_INVALID", "ext.market.invalid"],
] as const)("explains %s without claiming the market is empty", (code, key) => {
  render(<Market error={{ code, message: "unverified catalog contents" }} />);
  expect(screen.getByRole("alert")).toHaveTextContent(en[key]);
  expect(
    screen.queryByText("unverified catalog contents"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
  expect(
    screen.queryByText(en["ext.market.noMatches"]),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(en["ext.market.stale"])).not.toBeInTheDocument();
});

it("does not infer an empty market while the first catalog is loading", () => {
  render(<Market loading />);
  expect(screen.getByRole("status")).toHaveTextContent(
    en["ext.market.loading"],
  );
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
  expect(
    screen.queryByText(en["ext.market.noMatches"]),
  ).not.toBeInTheDocument();
});

it("distinguishes a verified empty catalog from filters with no matches", () => {
  const view = render(<Market data={emptySnapshot} />);
  expect(screen.getByText(en["ext.market.empty"])).toBeVisible();
  expect(
    screen.queryByText(en["ext.market.noMatches"]),
  ).not.toBeInTheDocument();
  view.rerender(<Market data={snapshot} />);
  expect(screen.getByRole("heading", { name: "Word Lab" })).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "unmatched plugin" },
  });
  expect(screen.getByText(en["ext.market.noMatches"])).toBeVisible();
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
});

it("retains the native stale-catalog status without a separate error", () => {
  render(<Market data={{ ...snapshot, stale: true }} />);
  expect(screen.getByRole("status")).toHaveTextContent(en["ext.market.stale"]);
  expect(screen.getByRole("heading", { name: "Word Lab" })).toBeVisible();
});

it("keeps the last verified catalog after refresh fails and identifies it until a valid refresh replaces it", async () => {
  vi.mocked(native.extensionMarketSnapshot)
    .mockResolvedValueOnce(snapshot)
    .mockRejectedValueOnce({
      code: "MARKET_INCOMPATIBLE",
      message: "unverified catalog contents",
    })
    .mockResolvedValueOnce(emptySnapshot);
  render(<LiveMarket />);
  await screen.findByRole("heading", { name: "Word Lab" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh market" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    en["ext.market.incompatible"],
  );
  expect(screen.getByRole("heading", { name: "Word Lab" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(en["ext.market.stale"]);
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "unmatched plugin" },
  });
  expect(screen.getByText(en["ext.market.noMatches"])).toBeVisible();
  expect(screen.getByText(en["ext.market.stale"])).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(en["ext.market.empty"])).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(en["ext.market.stale"])).not.toBeInTheDocument();
  expect(native.extensionMarketSnapshot).toHaveBeenNthCalledWith(1, false);
  expect(native.extensionMarketSnapshot).toHaveBeenNthCalledWith(2, true);
  expect(native.extensionMarketSnapshot).toHaveBeenNthCalledWith(3, true);
});

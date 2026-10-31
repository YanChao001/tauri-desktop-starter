import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import * as native from "@/lib/tauri";
import { ExtensionMarket } from "./extension-market";
import { useExtensionMarket } from "./use-extension-market";
import { toast } from "sonner";
import { marketUpdate } from "./market-model";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: vi.fn(() => true),
  extensionMarketSnapshot: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  const t = createTranslator(en);
  return { useI18n: () => ({ t, language: "en" }) };
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
  hostVersion: "0.1.6",
  incompatibleEntries: [],
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
  bundled = null,
  bundledError = null,
  error = null,
  loading = false,
  busy = false,
  downloadingId = null,
  downloadProgress = null,
  installingId = null,
  installed = [],
  onRefresh = vi.fn(),
  onDownload = vi.fn(),
  onInstallBundled = vi.fn(),
}: {
  data?: native.MarketSnapshot | null;
  bundled?: native.BundledExtensionCatalog | null;
  bundledError?: unknown;
  error?: unknown;
  loading?: boolean;
  busy?: boolean;
  downloadingId?: string | null;
  downloadProgress?: native.MarketDownloadProgress | null;
  installingId?: string | null;
  installed?: readonly native.ExtensionInfo[];
  onRefresh?: () => void;
  onDownload?: (entry: native.MarketEntry) => void;
  onInstallBundled?: (entry: native.BundledExtension) => void;
}) {
  return (
    <ExtensionMarket
      snapshot={data}
      bundled={bundled}
      bundledError={bundledError}
      error={error}
      loading={loading}
      busy={busy}
      downloadingId={downloadingId}
      downloadProgress={downloadProgress}
      installingId={installingId}
      installed={installed}
      onRefresh={onRefresh}
      onDownload={onDownload}
      onInstallBundled={onInstallBundled}
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
      downloadProgress={null}
      installingId={null}
      installed={[]}
      onRefresh={() => void market.reload()}
      onDownload={vi.fn()}
      onInstallBundled={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const bundled: native.BundledExtensionCatalog = {
  hostVersion: "0.1.8",
  entries: [
    {
      package: {
        ...entry.package,
        manifest: {
          ...entry.package.manifest,
          id: "starter.bundled",
          name: "Z Built-in tools",
        },
      },
      category: "tools",
    },
  ],
};

it("lists bundled plugins before online plugins and searches and filters both sources together", () => {
  render(<Market data={snapshot} bundled={bundled} />);
  expect(
    screen
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent),
  ).toEqual(["Z Built-in tools", "Word Lab"]);
  expect(screen.getAllByText("Built-in")).toHaveLength(1);
  expect(screen.queryByText("Featured")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "built-in" },
  });
  expect(
    screen.getByRole("heading", { name: "Z Built-in tools" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Word Lab" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(
    screen.getByRole("option", { name: en["ext.market.category.text"] }),
  );
  expect(screen.getByRole("heading", { name: "Word Lab" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Z Built-in tools" }),
  ).not.toBeInTheDocument();
});

it("keeps bundled installs available when the online market fails and uses their own source", () => {
  const install = vi.fn();
  const download = vi.fn();
  render(
    <Market
      bundled={bundled}
      error={{ code: "MARKET_UNAVAILABLE" }}
      onInstallBundled={install}
      onDownload={download}
    />,
  );
  const button = screen.getByRole("button", { name: "Install" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(install).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "bundled",
      package: bundled.entries[0]?.package,
    }),
  );
  expect(download).not.toHaveBeenCalled();
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
});

it("keeps online entries available when the bundled catalog fails", () => {
  const download = vi.fn();
  render(
    <Market
      data={snapshot}
      bundledError={{ code: "IO_ERROR" }}
      onDownload={download}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(download).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining(entry),
  );
  expect(screen.getByRole("alert")).toBeVisible();
});

it("shows received download percentages on the active button, then verifies and restores the download action", () => {
  const onDownload = vi.fn();
  const downloading = {
    data: snapshot,
    busy: true,
    downloadingId: entry.package.manifest.id,
    onDownload,
  };
  const view = render(<Market {...downloading} />);
  const preparing = screen.getByRole("button", {
    name: en["ext.market.preparing"],
  });
  expect(preparing).toBeDisabled();
  expect(preparing).toHaveAttribute("aria-busy", "true");
  expect(
    screen.getByRole("progressbar", { name: "Word Lab" }),
  ).not.toHaveAttribute("aria-valuenow");

  view.rerender(
    <Market
      {...downloading}
      downloadProgress={{
        phase: "downloading",
        receivedBytes: 50,
        totalBytes: 200,
      }}
    />,
  );
  const button = screen.getByRole("button", { name: "Downloading 25%" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("progressbar", { name: "Word Lab" })).toHaveAttribute(
    "aria-valuenow",
    "25",
  );
  fireEvent.click(button);
  expect(onDownload).not.toHaveBeenCalled();

  view.rerender(
    <Market
      {...downloading}
      downloadProgress={{
        phase: "downloading",
        receivedBytes: 149,
        totalBytes: 200,
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Downloading 74%" }),
  ).toBeDisabled();
  expect(screen.getByRole("progressbar", { name: "Word Lab" })).toHaveAttribute(
    "aria-valuenow",
    "74",
  );

  view.rerender(
    <Market {...downloading} downloadProgress={{ phase: "verifying" }} />,
  );
  expect(
    screen.getByRole("button", { name: en["ext.market.verifying"] }),
  ).toBeDisabled();
  expect(screen.getByRole("progressbar", { name: "Word Lab" })).toHaveAttribute(
    "aria-valuetext",
    en["ext.market.verifying"],
  );
  expect(
    screen.getByRole("progressbar", { name: "Word Lab" }),
  ).not.toHaveAttribute("aria-valuenow");

  view.rerender(<Market data={snapshot} onDownload={onDownload} />);
  const ready = screen.getByRole("button", { name: en["ext.market.download"] });
  expect(ready).toBeEnabled();
  expect(ready).toHaveAttribute("aria-busy", "false");
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  fireEvent.click(ready);
  expect(onDownload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining(entry),
  );
});

it("keeps the preparation state indeterminate until a download total is available", () => {
  render(
    <Market
      data={snapshot}
      downloadingId={entry.package.manifest.id}
      downloadProgress={{
        phase: "downloading",
        receivedBytes: 0,
        totalBytes: 0,
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: en["ext.market.preparing"] }),
  ).toBeDisabled();
  expect(
    screen.getByRole("progressbar", { name: "Word Lab" }),
  ).not.toHaveAttribute("aria-valuenow");
  expect(
    screen.queryByRole("button", { name: /Downloading \d+%/ }),
  ).not.toBeInTheDocument();
});

it("limits progress to the active plugin while other download buttons remain disabled", () => {
  const otherEntry: native.MarketEntry = {
    ...entry,
    package: {
      ...entry.package,
      manifest: {
        ...entry.package.manifest,
        id: "example.other",
        name: "Another plugin",
      },
    },
  };
  render(
    <Market
      data={{
        ...snapshot,
        catalog: { ...snapshot.catalog, entries: [entry, otherEntry] },
      }}
      busy
      downloadingId={entry.package.manifest.id}
      downloadProgress={{
        phase: "downloading",
        receivedBytes: 50,
        totalBytes: 200,
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Downloading 25%" }),
  ).toBeDisabled();
  const otherButton = screen.getByRole("button", {
    name: en["ext.market.download"],
  });
  expect(otherButton).toBeDisabled();
  expect(otherButton).toHaveAttribute("aria-busy", "false");
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  expect(
    screen.queryByRole("progressbar", { name: "Another plugin" }),
  ).not.toBeInTheDocument();
});

it("shows the installation phase without a fabricated percentage and restores the installed state", () => {
  const view = render(
    <Market data={snapshot} busy installingId={entry.package.manifest.id} />,
  );
  const button = screen.getByRole("button", {
    name: en["ext.market.installing"],
  });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("progressbar", { name: "Word Lab" })).toHaveAttribute(
    "aria-valuetext",
    en["ext.market.installing"],
  );
  expect(
    screen.getByRole("progressbar", { name: "Word Lab" }),
  ).not.toHaveAttribute("aria-valuenow");
  view.rerender(
    <Market
      data={snapshot}
      installed={[
        {
          package: entry.package,
          generation: 1,
          enabled: true,
          grantedPermissions: [],
          origin: { kind: "local" },
          previousPackage: null,
          previousOrigin: null,
        },
      ]}
    />,
  );
  const installed = screen.getByRole("button", {
    name: en["ext.market.installed"],
  });
  expect(installed).toBeDisabled();
  expect(installed).toHaveAttribute("aria-busy", "false");
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

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

it("keeps compatible entries usable while unknown future entries only show their host requirement", () => {
  const download = vi.fn();
  render(
    <Market
      onDownload={download}
      data={{
        ...snapshot,
        incompatibleEntries: [
          {
            id: "example.future",
            name: "Future Tool",
            version: "1.0.0",
            minHostVersion: "2.0.0",
            category: "tools",
          },
        ],
      }}
    />,
  );
  const future = screen
    .getByRole("heading", { name: "Future Tool" })
    .closest("article");
  if (!future) throw new Error("Expected a future plugin card");
  expect(within(future).getByText("Requires app 2.0.0 or newer")).toBeVisible();
  expect(within(future).queryByRole("button")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: en["ext.market.download"] }),
  );
  expect(download).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining(entry),
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Future Tool" },
  });
  expect(screen.getByRole("heading", { name: "Future Tool" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Word Lab" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
});

it("disables known future downloads and excludes them from installed update actions", () => {
  const future = {
    ...entry,
    package: {
      ...entry.package,
      manifest: { ...entry.package.manifest, minHostVersion: "0.2.0" },
    },
  };
  const download = vi.fn();
  render(
    <Market
      onDownload={download}
      data={{
        ...snapshot,
        catalog: { ...snapshot.catalog, entries: [future] },
      }}
    />,
  );
  const button = screen.getByRole("button", {
    name: en["ext.market.download"],
  });
  expect(button).toBeDisabled();
  expect(screen.getAllByText("Requires app 0.2.0 or newer")).toHaveLength(1);
  fireEvent.click(button);
  expect(download).not.toHaveBeenCalled();
  const installed: native.ExtensionInfo = {
    package: {
      ...entry.package,
      manifest: { ...entry.package.manifest, version: "1.0.0" },
    },
    generation: 1,
    enabled: false,
    grantedPermissions: [],
    origin: { kind: "local" },
    previousPackage: null,
    previousOrigin: null,
  };
  expect(marketUpdate([future], installed, "0.1.6")).toBeUndefined();
  expect(marketUpdate([entry], installed, "0.1.6")).toBe(entry);
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

it("keeps an existing error toast stable while its retry callback changes", () => {
  const error = { code: "MARKET_UNAVAILABLE" };
  const firstRefresh = vi.fn();
  const latestRefresh = vi.fn();
  const view = render(
    <Market data={snapshot} error={error} onRefresh={firstRefresh} />,
  );
  expect(toast.error).toHaveBeenCalledTimes(1);
  const retry = vi.mocked(toast.error).mock.calls[0]?.[1]?.action;
  view.rerender(
    <Market data={snapshot} error={error} loading onRefresh={latestRefresh} />,
  );
  expect(toast.error).toHaveBeenCalledTimes(1);
  if (
    !retry ||
    typeof retry !== "object" ||
    !("onClick" in retry) ||
    typeof retry.onClick !== "function"
  )
    throw new Error("Expected a retry action");
  render(<button onClick={retry.onClick}>Retry retained error</button>);
  fireEvent.click(screen.getByRole("button", { name: "Retry retained error" }));
  expect(latestRefresh).toHaveBeenCalledTimes(1);
  expect(firstRefresh).not.toHaveBeenCalled();
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
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      en["ext.market.incompatible"],
      expect.objectContaining({
        action: expect.objectContaining({ label: "Retry" }),
      }),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Word Lab" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(en["ext.market.stale"]);
  expect(screen.queryByText(en["ext.market.empty"])).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "unmatched plugin" },
  });
  expect(screen.getByText(en["ext.market.noMatches"])).toBeVisible();
  expect(screen.getByText(en["ext.market.stale"])).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText(en["ext.market.empty"])).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(en["ext.market.stale"])).not.toBeInTheDocument();
  expect(native.extensionMarketSnapshot).toHaveBeenNthCalledWith(1, false);
  expect(native.extensionMarketSnapshot).toHaveBeenNthCalledWith(2, true);
  expect(native.extensionMarketSnapshot).toHaveBeenNthCalledWith(3, true);
});

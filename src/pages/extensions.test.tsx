import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import * as native from "@/lib/tauri";
import Extensions from "./extensions";
import { ExtensionsProvider } from "@/features/extensions/extensions-provider";
import { useLocation } from "react-router-dom";
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: () => true,
  extensionSnapshot: vi.fn(),
  extensionDemo: vi.fn(),
  previewExtension: vi.fn(),
  installExtension: vi.fn(),
  setExtensionEnabled: vi.fn(),
  onExtensionsChanged: vi.fn(),
  viewExtension: vi.fn(),
  extensionMarketSnapshot: vi.fn(),
  downloadMarketExtension: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});
const preview: native.ExtensionPreview = {
  manifest: {
    formatVersion: 2,
    apiVersion: 1,
    id: "test.example",
    version: "1.0.0",
    name: "Example",
    author: "Local",
    description: "Test example",
    inputFormat: "text",
    resultFormat: "text",
    commands: [{ id: "run", title: "Run", function: "run" }],
    permissions: ["text:read"],
  },
  sha256: "b".repeat(64),
  bytes: 100,
};
let snapshot: native.ExtensionSnapshot;
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = {
    revision: 0,
    items: [],
    runningId: null,
  };
  vi.mocked(native.extensionSnapshot).mockImplementation(async () => snapshot);
  vi.mocked(native.previewExtension).mockResolvedValue(preview);
  vi.mocked(native.extensionDemo).mockResolvedValue("demo-package");
  vi.mocked(native.onExtensionsChanged).mockResolvedValue(vi.fn());
  vi.mocked(native.extensionMarketSnapshot).mockResolvedValue({
    catalog: {
      schemaVersion: 1,
      revision: 1,
      repository: "owner/market",
      entries: [],
    },
    fetchedAt: Date.now(),
    stale: false,
  });
});
afterEach(cleanup);

it("previews without installing, then installs disabled and requires every consent to enable", async () => {
  vi.mocked(native.installExtension).mockImplementation(async () => {
    snapshot = {
      ...snapshot,
      revision: 1,
      items: [
        {
          package: preview,
          enabled: false,
          grantedPermissions: [],
        },
      ],
    };
    return snapshot;
  });
  vi.mocked(native.setExtensionEnabled).mockImplementation(async () => {
    snapshot = {
      ...snapshot,
      revision: 2,
      items: snapshot.items.map((item) => ({
        ...item,
        enabled: true,
        grantedPermissions: ["text:read"],
      })),
    };
    return snapshot;
  });
  render(
    <MemoryRouter>
      <ExtensionsProvider>
        <Extensions />
        <Location />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  const input = await screen.findByLabelText("Choose extension package");
  await waitFor(() => expect(input).toBeEnabled());
  const file = new File(["demo-package"], "example.starter-extension.json", {
    type: "application/json",
  });
  file.arrayBuffer = async () =>
    new TextEncoder().encode("demo-package").buffer;
  fireEvent.change(input, { target: { files: [file] } });
  const review = await screen.findByRole("dialog");
  expect(within(review).getByText(preview.sha256)).toBeVisible();
  expect(native.installExtension).not.toHaveBeenCalled();
  fireEvent.click(
    within(review).getByRole("button", { name: "Install and keep disabled" }),
  );
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledWith(
      "demo-package",
      0,
      false,
      preview.sha256,
    ),
  );
  const enable = await screen.findByRole("button", {
    name: "Enable",
  });
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  fireEvent.click(enable);
  const decision = await screen.findByRole("dialog");
  const confirm = within(decision).getByRole("button", {
    name: "Enable",
  });
  expect(confirm).toBeDisabled();
  const boxes = within(decision).getAllByRole("checkbox");
  fireEvent.click(boxes[0]!);
  expect(confirm).toBeDisabled();
  fireEvent.click(boxes[1]!);
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(native.setExtensionEnabled).toHaveBeenCalledWith(
      "test.example",
      true,
      ["text:read"],
      1,
      true,
    ),
  );
  await screen.findByRole("button", { name: "Disable" });
});

it("releases a subscription that arrives after unmount", async () => {
  let resolve!: (stop: () => void) => void;
  const stop = vi.fn();
  vi.mocked(native.onExtensionsChanged).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(
    <MemoryRouter>
      <ExtensionsProvider>
        <Extensions />
        <Location />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  view.unmount();
  await act(async () => resolve(stop));
  expect(stop).toHaveBeenCalledOnce();
});

function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

const marketEntry: native.MarketEntry = {
  package: { ...preview, manifest: { ...preview.manifest, version: "1.10.0" } },
  category: "text",
  featured: true,
  releaseTag: "market-1",
  asset: "test.example-1.10.0.starter-extension.json",
  packageSha256: "c".repeat(64),
  packageBytes: 500,
};
function marketPage() {
  return render(
    <MemoryRouter>
      <ExtensionsProvider>
        <Extensions />
        <Location />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
}
it("downloads a market package for review and installs only after confirmation with the module hash", async () => {
  const user = userEvent.setup();
  vi.mocked(native.extensionMarketSnapshot).mockResolvedValue({
    catalog: {
      schemaVersion: 1,
      revision: 1,
      repository: "owner/market",
      entries: [marketEntry],
    },
    fetchedAt: Date.now(),
    stale: false,
  });
  vi.mocked(native.downloadMarketExtension).mockResolvedValue({
    content: "verified-package",
    preview: marketEntry.package,
  });
  vi.mocked(native.installExtension).mockResolvedValue(snapshot);
  marketPage();
  await user.click(
    await screen.findByRole("tab", { name: "Discover plugins" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Download and review" }),
  );
  const review = await screen.findByRole("dialog");
  expect(native.downloadMarketExtension).toHaveBeenCalledWith(
    preview.manifest.id,
    marketEntry.packageSha256,
  );
  expect(native.installExtension).not.toHaveBeenCalled();
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  await user.click(
    within(review).getByRole("button", { name: "Install and keep disabled" }),
  );
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledWith(
      "verified-package",
      0,
      false,
      preview.sha256,
    ),
  );
});
it("offers numeric version updates and retains the installed package when download verification fails", async () => {
  const user = userEvent.setup();
  snapshot.items = [
    {
      package: {
        ...preview,
        manifest: { ...preview.manifest, version: "1.2.0" },
      },
      enabled: true,
      grantedPermissions: ["text:read"],
    },
  ];
  vi.mocked(native.extensionMarketSnapshot).mockResolvedValue({
    catalog: {
      schemaVersion: 1,
      revision: 1,
      repository: "owner/market",
      entries: [marketEntry],
    },
    fetchedAt: Date.now(),
    stale: false,
  });
  vi.mocked(native.downloadMarketExtension).mockRejectedValue({
    code: "MARKET_INVALID",
  });
  marketPage();
  await user.click(
    await screen.findByRole("button", { name: "Update to 1.10.0" }),
  );
  await screen.findByText(
    "Market catalog or package verification failed. No extensions were installed or changed.",
  );
  expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled();
  expect(native.installExtension).not.toHaveBeenCalled();
  expect(snapshot.items[0]?.package.manifest.version).toBe("1.2.0");
});
it("keeps a verified catalog visible after refresh failure and filters it without network searches", async () => {
  const user = userEvent.setup();
  vi.mocked(native.extensionMarketSnapshot)
    .mockResolvedValueOnce({
      catalog: {
        schemaVersion: 1,
        revision: 1,
        repository: "owner/market",
        entries: [marketEntry],
      },
      fetchedAt: Date.now(),
      stale: false,
    })
    .mockRejectedValueOnce({ code: "MARKET_UNAVAILABLE" });
  marketPage();
  await user.click(
    await screen.findByRole("tab", { name: "Discover plugins" }),
  );
  await screen.findByRole("button", { name: "Download and review" });
  await user.click(screen.getByRole("button", { name: "Refresh market" }));
  await screen.findByText(
    "The plugin market is unavailable. Check your connection and refresh. Installed extensions remain available.",
  );
  expect(
    screen.getByRole("button", { name: "Download and review" }),
  ).toBeEnabled();
  await user.type(
    screen.getByRole("searchbox", { name: "Search plugins" }),
    "not-found",
  );
  expect(
    screen.queryByRole("button", { name: "Download and review" }),
  ).toBeNull();
  expect(native.extensionMarketSnapshot).toHaveBeenCalledTimes(2);
});
it("keeps installation unavailable for an incompatible registry and recovers after refresh", async () => {
  vi.mocked(native.extensionSnapshot).mockRejectedValue({
    code: "EXTENSION_INCOMPATIBLE",
    message: "Old registry",
    retryable: false,
  });
  render(
    <MemoryRouter>
      <ExtensionsProvider>
        <Extensions />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Choose extension package")).toBeDisabled();
  const refresh = screen.getByRole("button", { name: "Refresh extensions" });
  await waitFor(() => expect(refresh).toBeEnabled());
  vi.mocked(native.extensionSnapshot).mockResolvedValue(snapshot);
  fireEvent.click(refresh);
  await waitFor(() =>
    expect(screen.getByLabelText("Choose extension package")).toBeEnabled(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("shows a bundled app once in the installed list and opens a normal route without executing or reinstalling", async () => {
  snapshot.items = [
    {
      package: {
        ...preview,
        manifest: {
          ...preview.manifest,
          name: "Extension Lab",
          id: "starter.extension-lab",
          inputFormat: "json",
          resultFormat: "view",
          ui: { sidebar: true, window: true },
        },
      },
      enabled: true,
      grantedPermissions: [],
    },
  ];
  render(
    <MemoryRouter>
      <ExtensionsProvider>
        <Extensions />
        <Location />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  const open = await screen.findByRole("button", {
    name: "Open Extension Lab",
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.queryByText("Bundled app examples")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Run a tool" }),
  ).not.toBeInTheDocument();
  fireEvent.click(open);
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/extensions/app/starter.extension-lab/run",
  );
  expect(native.installExtension).not.toHaveBeenCalled();
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  expect(native.viewExtension).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("restores keyboard focus to the action that opened the consent dialog", async () => {
  const user = userEvent.setup();
  snapshot.items = [
    { package: preview, enabled: false, grantedPermissions: [] },
  ];
  render(
    <MemoryRouter>
      <ExtensionsProvider>
        <Extensions />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
  const enable = await screen.findByRole("button", { name: "Enable" });
  await user.click(enable);
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(enable).toHaveFocus());
});

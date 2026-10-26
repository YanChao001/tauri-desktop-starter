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
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: () => true,
  extensionSnapshot: vi.fn(),
  extensionDemo: vi.fn(),
  previewExtension: vi.fn(),
  previewExtensionArchive: vi.fn(),
  installExtension: vi.fn(),
  installMarketExtension: vi.fn(),
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
    formatVersion: 3,
    apiVersion: 2,
    id: "test.example",
    version: "1.0.0",
    name: "Example",
    author: "Local",
    description: "Test example",
    commands: [
      {
        id: "run",
        title: "Run",
        function: "run",
        inputFormat: "text",
        resultFormat: "text",
        permissions: [],
      },
    ],
    permissions: ["text:read"],
    minHostVersion: "0.1.0",
    optionalPermissions: [],
    network: [],
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
    runs: [],
  };
  vi.mocked(native.extensionSnapshot).mockImplementation(async () => snapshot);
  vi.mocked(native.previewExtension).mockResolvedValue(preview);
  vi.mocked(native.previewExtensionArchive).mockResolvedValue({
    status: "current",
    schemaVersion: 3,
    fingerprint: null,
    installedCount: 0,
  });
  vi.mocked(native.extensionDemo).mockResolvedValue("demo-package");
  vi.mocked(native.onExtensionsChanged).mockResolvedValue(vi.fn());
  vi.mocked(native.extensionMarketSnapshot).mockResolvedValue({
    catalog: {
      schemaVersion: 2,
      issuedAt: 1,
      expiresAt: 9999999999,
      revision: 1,
      repository: "owner/market",
      entries: [],
    },
    hostVersion: "0.1.6",
    incompatibleEntries: [],
    fetchedAt: Date.now(),
    stale: false,
  });
});
afterEach(cleanup);

it("reviews permissions once and installs enabled without a separate activation step", async () => {
  const packagePreview = {
    ...preview,
    manifest: {
      ...preview.manifest,
      optionalPermissions: ["storage" as const],
    },
  };
  vi.mocked(native.previewExtension).mockResolvedValue(packagePreview);
  vi.mocked(native.installExtension).mockImplementation(
    async (_content, _revision, _replace, _hash, consent) => {
      snapshot = {
        revision: 1,
        runs: [],
        items: [
          {
            generation: 1,
            origin: { kind: "local" },
            package: packagePreview,
            enabled: true,
            grantedPermissions: consent.grantedPermissions,
          },
        ],
      };
      return snapshot;
    },
  );
  marketPage();
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
  for (const checkbox of within(review).getAllByRole("checkbox"))
    expect(checkbox).not.toBeChecked();
  expect(
    within(review).getByRole("checkbox", {
      name: "Select all optional capabilities",
    }),
  ).toBeVisible();
  fireEvent.click(
    within(review).getByRole("button", { name: "Install and enable" }),
  );
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledWith(
      "demo-package",
      0,
      false,
      preview.sha256,
      { trusted: true, grantedPermissions: ["text:read"] },
    ),
  );
  await screen.findByRole("button", { name: "Disable" });
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  expect(native.viewExtension).not.toHaveBeenCalled();
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

it("keeps the generic command runner out of the center until a tool is explicitly opened", async () => {
  snapshot = {
    revision: 1,
    runs: [],
    items: [
      {
        package: preview,
        generation: 1,
        enabled: true,
        grantedPermissions: ["text:read"],
        origin: { kind: "local" },
      },
    ],
  };
  marketPage();
  await screen.findByRole("button", { name: "Disable" });
  expect(document.getElementById("extension-runner")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByRole("heading", { name: "Run a tool" });
  expect(document.getElementById("extension-runner")).toBeVisible();
});

const marketEntry: native.MarketEntry = {
  package: { ...preview, manifest: { ...preview.manifest, version: "1.10.0" } },
  category: "text",
  featured: true,
  releaseTag: "market-1",
  asset: "test.example-1.10.0.starter-extension.json",
  packageSha256: "c".repeat(64),
  packageBytes: 500,
};
const marketSource = {
  repository: "owner/market",
  publicKeyFingerprint: "d".repeat(64),
  catalogRevision: 1,
  packageSha256: marketEntry.packageSha256,
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
      schemaVersion: 2,
      issuedAt: 1,
      expiresAt: 9999999999,
      revision: 1,
      repository: "owner/market",
      entries: [marketEntry],
    },
    hostVersion: "0.1.6",
    incompatibleEntries: [],
    fetchedAt: Date.now(),
    stale: false,
  });
  vi.mocked(native.downloadMarketExtension).mockResolvedValue({
    content: "verified-package",
    preview: marketEntry.package,
    source: marketSource,
  });
  vi.mocked(native.installMarketExtension).mockResolvedValue(snapshot);
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
    within(review).getByRole("button", { name: "Install and enable" }),
  );
  await waitFor(() =>
    expect(native.installMarketExtension).toHaveBeenCalledWith(
      "verified-package",
      0,
      false,
      preview.sha256,
      marketSource,
      { trusted: true, grantedPermissions: ["text:read"] },
    ),
  );
});
it("offers numeric version updates and retains the installed package when download verification fails", async () => {
  const user = userEvent.setup();
  snapshot.items = [
    {
      generation: 1,
      origin: { kind: "local" },
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
      schemaVersion: 2,
      issuedAt: 1,
      expiresAt: 9999999999,
      revision: 1,
      repository: "owner/market",
      entries: [marketEntry],
    },
    hostVersion: "0.1.6",
    incompatibleEntries: [],
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
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Market catalog or package verification failed. No extensions were installed or changed.",
      expect.anything(),
    ),
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
        schemaVersion: 2,
        issuedAt: 1,
        expiresAt: 9999999999,
        revision: 1,
        repository: "owner/market",
        entries: [marketEntry],
      },
      hostVersion: "0.1.6",
      incompatibleEntries: [],
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
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "The plugin market is unavailable. Check your connection and refresh. Installed extensions remain available.",
      expect.anything(),
    ),
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
      generation: 1,
      origin: { kind: "local" },
      package: {
        ...preview,
        manifest: {
          ...preview.manifest,
          name: "Extension Lab",
          id: "starter.extension-lab",
          commands: preview.manifest.commands.map((command) => ({
            ...command,
            inputFormat: "json",
            resultFormat: "view",
            ui: { sidebar: true, window: true },
          })),
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
    {
      generation: 1,
      origin: { kind: "local" },
      package: preview,
      enabled: false,
      grantedPermissions: [],
    },
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

it("enables offline commands without optional networking and allows grants to change later", async () => {
  const offline: native.ExtensionPreview = {
    ...preview,
    manifest: {
      ...preview.manifest,
      permissions: [],
      optionalPermissions: ["network:https"],
      network: [{ origin: "https://example.com", methods: ["GET"] }],
    },
  };
  snapshot.items = [
    {
      generation: 1,
      origin: { kind: "local" },
      package: offline,
      enabled: false,
      grantedPermissions: [],
    },
  ];
  vi.mocked(native.setExtensionEnabled).mockImplementation(
    async (_id, enabled, grants) => {
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        items: snapshot.items.map((item) => ({
          ...item,
          enabled,
          grantedPermissions: grants,
        })),
      };
      return snapshot;
    },
  );
  marketPage();
  fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
  const dialog = await screen.findByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "Enable" });
  expect(confirm).toBeEnabled();
  for (const checkbox of within(dialog).getAllByRole("checkbox"))
    expect(checkbox).not.toBeChecked();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(native.setExtensionEnabled).toHaveBeenCalledWith(
      "test.example",
      true,
      [],
      0,
      true,
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage permissions" }),
  );
  const permissions = await screen.findByRole("dialog");
  fireEvent.click(
    within(permissions).getByRole("checkbox", {
      name: "Select all optional capabilities",
    }),
  );
  fireEvent.click(
    within(permissions).getByRole("button", { name: "Save permissions" }),
  );
  await waitFor(() =>
    expect(native.setExtensionEnabled).toHaveBeenLastCalledWith(
      "test.example",
      true,
      ["network:https"],
      1,
      true,
    ),
  );
});

const bundledLab: native.ExtensionPreview = {
  ...preview,
  manifest: {
    ...preview.manifest,
    id: "starter.extension-lab",
    name: "Extension Lab",
    version: "2.0.0",
  },
};

it("checks an installed bundled lab without opening an invalid same-version upgrade", async () => {
  snapshot.items = [
    {
      generation: 1,
      origin: { kind: "bundled" },
      package: bundledLab,
      enabled: false,
      grantedPermissions: [],
    },
  ];
  vi.mocked(native.previewExtension).mockResolvedValue(bundledLab);
  marketPage();
  const check = await screen.findByRole("button", {
    name: "Check bundled workbench for updates",
  });
  await waitFor(() => expect(check).toBeEnabled());
  expect(native.extensionDemo).not.toHaveBeenCalled();
  fireEvent.click(check);
  await waitFor(() =>
    expect(toast.info).toHaveBeenCalledWith(
      "The bundled workbench is already up to date.",
      expect.anything(),
    ),
  );
  expect(native.extensionDemo).toHaveBeenCalledExactlyOnceWith(
    "starter.extension-lab",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(native.installExtension).not.toHaveBeenCalled();
});

it("reviews a newer bundled lab and installs it only after confirmation using the captured revision", async () => {
  snapshot.revision = 23;
  snapshot.items = [
    {
      generation: 3,
      origin: { kind: "bundled" },
      package: {
        ...bundledLab,
        sha256: "a".repeat(64),
        manifest: { ...bundledLab.manifest, version: "1.0.0" },
      },
      enabled: false,
      grantedPermissions: [],
    },
  ];
  vi.mocked(native.previewExtension).mockResolvedValue(bundledLab);
  vi.mocked(native.installExtension).mockResolvedValue(snapshot);
  marketPage();
  const check = await screen.findByRole("button", {
    name: "Check bundled workbench for updates",
  });
  await waitFor(() => expect(check).toBeEnabled());
  fireEvent.click(check);
  const review = await screen.findByRole("dialog");
  expect(within(review).getByText("2.0.0")).toBeVisible();
  expect(native.installExtension).not.toHaveBeenCalled();
  fireEvent.click(
    within(review).getByRole("button", { name: "Update and enable" }),
  );
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledWith(
      "demo-package",
      23,
      true,
      bundledLab.sha256,
      { trusted: true, grantedPermissions: ["text:read"] },
    ),
  );
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
});

it.each([
  [
    "3.0.0",
    bundledLab.sha256,
    "The installed workbench is newer than the bundled version.",
  ],
  [
    "2.0.0",
    "a".repeat(64),
    "The installed workbench has the same version but different contents.",
  ],
])(
  "retains an installed lab at %s when a bundled replacement cannot upgrade it",
  async (version, sha256, text) => {
    snapshot.items = [
      {
        generation: 1,
        origin: { kind: "local" },
        package: {
          ...bundledLab,
          sha256,
          manifest: { ...bundledLab.manifest, version },
        },
        enabled: false,
        grantedPermissions: [],
      },
    ];
    vi.mocked(native.previewExtension).mockResolvedValue(bundledLab);
    marketPage();
    const check = await screen.findByRole("button", {
      name: "Check bundled workbench for updates",
    });
    await waitFor(() => expect(check).toBeEnabled());
    fireEvent.click(check);
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining(text),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(native.installExtension).not.toHaveBeenCalled();
  },
);

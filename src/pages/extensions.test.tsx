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
import { en } from "@/i18n/en";
import * as native from "@/lib/tauri";
import Extensions from "./extensions";
import { ExtensionsProvider } from "@/features/extensions/extensions-provider";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  isTauri: () => true,
  extensionSnapshot: vi.fn(),
  prepareEnabledExtensions: vi.fn().mockResolvedValue(undefined),
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

it("shows initial loading, then a recoverable error instead of an empty installed list", async () => {
  let rejectSnapshot!: (reason: unknown) => void;
  vi.mocked(native.extensionSnapshot).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectSnapshot = reject;
    }),
  );
  marketPage();
  expect(screen.getByRole("status", { name: "Loading…" })).toBeVisible();
  expect(screen.queryByText(en["ext.empty"])).not.toBeInTheDocument();
  await waitFor(() => expect(native.extensionSnapshot).toHaveBeenCalledOnce());
  await act(async () => rejectSnapshot({ code: "IO_ERROR" }));
  expect(
    screen.queryByRole("status", { name: "Loading…" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(en["ext.empty"])).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("only views permissions for a disabled extension without activating it", async () => {
  const user = userEvent.setup();
  snapshot.items = [
    {
      generation: 1,
      origin: { kind: "local" },
      package: {
        ...preview,
        manifest: { ...preview.manifest, optionalPermissions: ["storage"] },
      },
      enabled: false,
      grantedPermissions: [],
    },
  ];
  marketPage();
  const more = await screen.findByRole("button", {
    name: "Actions for Example",
  });
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Permissions" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Permissions",
  });
  expect(dialog).toHaveAccessibleDescription(en["ext.disabledPermissionsHint"]);
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
  const [close] = within(dialog).getAllByRole("button", { name: "Close" });
  if (!close) throw new Error("权限详情缺少关闭操作");
  await user.click(close);
  await waitFor(() => expect(more).toHaveFocus());
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  expect(snapshot.items).toEqual([expect.objectContaining({ enabled: false })]);
});

it("reviews permissions once and installs enabled without a separate activation step", async () => {
  const user = userEvent.setup();
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
      if (!consent) throw new Error("首次安装必须传入已审阅授权");
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
  marketPage("discover");
  const input = await screen.findByLabelText("Choose package");
  await waitFor(() => expect(input).toBeEnabled());
  const file = new File(["demo-package"], "example.starter-extension.json", {
    type: "application/json",
  });
  file.arrayBuffer = async () =>
    new TextEncoder().encode("demo-package").buffer;
  fireEvent.change(input, { target: { files: [file] } });
  const review = await screen.findByRole("dialog");
  expect(within(review).queryByText(preview.sha256)).not.toBeInTheDocument();
  await user.click(within(review).getByText(en["ext.technicalInfo"]));
  expect(within(review).queryByText(preview.sha256)).not.toBeInTheDocument();
  expect(native.installExtension).not.toHaveBeenCalled();
  for (const checkbox of within(review).getAllByRole("checkbox"))
    expect(checkbox).not.toBeChecked();
  expect(
    within(review).getByRole("checkbox", {
      name: en["ext.selectAllOptionalPermissions"],
    }),
  ).toBeVisible();
  fireEvent.click(within(review).getByRole("button", { name: "Install" }));
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledWith(
      "demo-package",
      0,
      false,
      preview.sha256,
      { trusted: true, grantedPermissions: ["text:read"] },
    ),
  );
  await user.click(screen.getByRole("tab", { name: "Installed" }));
  await user.click(
    await screen.findByRole("button", { name: "Actions for Example" }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Disable" }),
  ).not.toHaveAttribute("aria-disabled", "true");
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
  const user = userEvent.setup();
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
  const more = await screen.findByRole("button", {
    name: "Actions for Example",
  });
  await user.click(more);
  expect(
    await screen.findByRole("menuitem", { name: "Disable" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Escape}");
  expect(document.getElementById("extension-runner")).toBeNull();
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Open" }));
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
function marketPage(tab: "installed" | "discover" = "installed") {
  return render(
    <MemoryRouter
      initialEntries={[tab === "discover" ? "/?tab=discover" : "/"]}
    >
      <ExtensionsProvider>
        <Extensions />
        <Location />
      </ExtensionsProvider>
    </MemoryRouter>,
  );
}

function prepareMarketUpgrade(enabled = true) {
  const previous: native.ExtensionInfo = {
    package: {
      ...preview,
      sha256: "a".repeat(64),
      manifest: { ...preview.manifest, optionalPermissions: ["storage"] },
    },
    generation: 3,
    enabled,
    grantedPermissions: enabled ? ["text:read", "storage"] : [],
    origin: { kind: "market", source: marketSource },
  };
  const next: native.ExtensionPreview = {
    ...preview,
    manifest: { ...previous.package.manifest, version: "2.0.0" },
  };
  const source = {
    ...marketSource,
    catalogRevision: 2,
    packageSha256: "e".repeat(64),
  };
  snapshot = { revision: 7, items: [previous], runs: [] };
  vi.mocked(native.extensionMarketSnapshot).mockResolvedValue({
    catalog: {
      schemaVersion: 2,
      issuedAt: 1,
      expiresAt: 9999999999,
      revision: 2,
      repository: source.repository,
      entries: [
        { ...marketEntry, package: next, packageSha256: source.packageSha256 },
      ],
    },
    hostVersion: "0.1.6",
    incompatibleEntries: [],
    fetchedAt: Date.now(),
    stale: false,
  });
  const downloaded = { content: "verified-update", preview: next, source };
  vi.mocked(native.downloadMarketExtension).mockResolvedValue(downloaded);
  vi.mocked(native.installMarketExtension).mockImplementation(async () => {
    snapshot = {
      ...snapshot,
      revision: 8,
      items: [
        {
          ...previous,
          package: next,
          generation: 4,
          origin: { kind: "market", source },
        },
      ],
    };
    return snapshot;
  });
  return { previous, next, downloaded };
}

it.each([true, false])(
  "同来源权限不变的市场升级不重复确认并保留启用状态 %s",
  async (enabled) => {
    const { previous, next, downloaded } = prepareMarketUpgrade(enabled);
    marketPage("discover");
    const button = await screen.findByRole("button", {
      name: "Update",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(native.installMarketExtension).toHaveBeenCalledExactlyOnceWith(
        downloaded.content,
        7,
        true,
        next.sha256,
        downloaded.source,
        undefined,
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(snapshot.items[0]).toMatchObject({
      enabled,
      grantedPermissions: previous.grantedPermissions,
      package: { manifest: { version: "2.0.0" } },
    });
    expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  },
);

it("市场更新冲突只报错一次，不自动补授权重试或报告成功", async () => {
  const { previous } = prepareMarketUpgrade();
  vi.mocked(native.installMarketExtension).mockRejectedValue({
    code: "CONFLICT",
  });
  marketPage("discover");
  const button = await screen.findByRole("button", { name: "Update" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  await waitFor(() => expect(button).toBeEnabled());
  expect(native.installMarketExtension).toHaveBeenCalledOnce();
  expect(native.installMarketExtension).toHaveBeenLastCalledWith(
    "verified-update",
    7,
    true,
    preview.sha256,
    expect.anything(),
    undefined,
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(snapshot.items).toEqual([previous]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("真实下载预览有新权限时保留审阅，刷新完成后在原卡片恢复焦点且不滚动", async () => {
  const user = userEvent.setup();
  const { next, downloaded } = prepareMarketUpgrade();
  vi.mocked(native.downloadMarketExtension).mockResolvedValue({
    ...downloaded,
    preview: {
      ...next,
      manifest: { ...next.manifest, permissions: ["text:read", "files:read"] },
    },
  });
  marketPage("discover");
  const button = await screen.findByRole("button", { name: "Update" });
  await waitFor(() => expect(button).toBeEnabled());
  const card = button.closest("article");
  if (!card) throw new Error("更新入口应属于稳定卡片");
  const focus = vi.spyOn(card, "focus");
  await user.click(button);
  const dialog = await screen.findByRole("dialog");
  expect(native.installMarketExtension).not.toHaveBeenCalled();
  let finishReload!: (value: native.ExtensionSnapshot) => void;
  vi.mocked(native.extensionSnapshot).mockReturnValueOnce(
    new Promise((resolve) => {
      finishReload = resolve;
    }),
  );
  await user.click(within(dialog).getByRole("button", { name: "Update" }));
  await waitFor(() =>
    expect(native.extensionSnapshot).toHaveBeenCalledTimes(2),
  );
  expect(dialog).toBeVisible();
  expect(native.installMarketExtension).toHaveBeenLastCalledWith(
    downloaded.content,
    7,
    true,
    next.sha256,
    downloaded.source,
    {
      trusted: true,
      grantedPermissions: ["text:read", "files:read", "storage"],
    },
  );
  await act(async () => finishReload(snapshot));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(card).toHaveFocus());
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(button).toBeDisabled();
});

it("本地文件即使版本与权限符合仍需人工审阅", async () => {
  const { next } = prepareMarketUpgrade();
  vi.mocked(native.previewExtension).mockResolvedValue(next);
  marketPage("discover");
  const input = await screen.findByLabelText("Choose package");
  await waitFor(() => expect(input).toBeEnabled());
  const file = new File(["local-update"], "update.starter-extension.json");
  file.arrayBuffer = async () =>
    new TextEncoder().encode("local-update").buffer;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("dialog");
  expect(native.installExtension).not.toHaveBeenCalled();
  expect(native.installMarketExtension).not.toHaveBeenCalled();
});

it("卸载页面后晚到的市场下载不继续安装", async () => {
  const { downloaded } = prepareMarketUpgrade();
  let finishDownload!: (value: native.MarketDownload) => void;
  vi.mocked(native.downloadMarketExtension).mockReturnValue(
    new Promise((resolve) => {
      finishDownload = resolve;
    }),
  );
  const view = marketPage("discover");
  const button = await screen.findByRole("button", { name: "Update" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(native.downloadMarketExtension).toHaveBeenCalledOnce(),
  );
  view.unmount();
  await act(async () => finishDownload(downloaded));
  expect(native.installMarketExtension).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
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
  let reportProgress: (
    progress: native.MarketDownloadProgress,
  ) => void = () => {};
  let finishDownload: (download: native.MarketDownload) => void = () => {};
  const download = new Promise<native.MarketDownload>((resolve) => {
    finishDownload = resolve;
  });
  vi.mocked(native.downloadMarketExtension).mockImplementation(
    (_id, _sha256, onProgress) => {
      reportProgress = onProgress;
      return download;
    },
  );
  let finishInstall: (value: native.ExtensionSnapshot) => void = () => {};
  vi.mocked(native.installMarketExtension).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishInstall = resolve;
      }),
  );
  marketPage();
  await user.click(
    await screen.findByRole("tab", { name: "Discover plugins" }),
  );
  const downloadButton = await screen.findByRole("button", {
    name: "Install",
  });
  await user.click(downloadButton);
  expect(downloadButton).toHaveAccessibleName("Preparing…");
  expect(downloadButton).toBeDisabled();
  act(() =>
    reportProgress({
      phase: "downloading",
      receivedBytes: 185,
      totalBytes: 500,
    }),
  );
  expect(downloadButton).toHaveAccessibleName("Downloading 37%");
  expect(native.installMarketExtension).not.toHaveBeenCalled();
  act(() => reportProgress({ phase: "verifying" }));
  expect(downloadButton).toHaveAccessibleName("Verifying…");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => {
    finishDownload({
      content: "verified-package",
      preview: marketEntry.package,
      source: marketSource,
    });
    await download;
  });
  const review = await screen.findByRole("dialog");
  expect(downloadButton).toHaveAttribute("aria-busy", "false");
  act(() => reportProgress({ phase: "verifying" }));
  expect(downloadButton).toHaveAttribute("aria-busy", "false");
  expect(native.downloadMarketExtension).toHaveBeenCalledWith(
    preview.manifest.id,
    marketEntry.packageSha256,
    expect.any(Function),
  );
  expect(native.installExtension).not.toHaveBeenCalled();
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
  await user.click(within(review).getByRole("button", { name: "Install" }));
  expect(downloadButton).toHaveAttribute("aria-busy", "true");
  expect(
    within(review).getByRole("button", { name: "Installing…" }),
  ).toBeDisabled();
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
  await act(async () => finishInstall(snapshot));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(downloadButton).toHaveAccessibleName("Install");
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
  const more = await screen.findByRole("button", {
    name: "Actions for Example",
  });
  await user.click(more);
  await user.click(
    await screen.findByRole("menuitem", { name: "Update to 1.10.0" }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Market catalog or package verification failed. No extensions were installed or changed.",
      expect.anything(),
    ),
  );
  await waitFor(() => expect(more).toBeEnabled());
  await user.click(more);
  expect(screen.getByRole("menuitem", { name: "Disable" })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
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
  await screen.findByRole("button", { name: "Install" });
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Market unavailable. Check your connection and refresh. Installed extensions remain available.",
      expect.anything(),
    ),
  );
  expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  await user.type(
    screen.getByRole("searchbox", { name: "Search plugins" }),
    "not-found",
  );
  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
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
  expect(screen.getByLabelText("Choose package")).toBeDisabled();
  const refresh = screen.getByRole("button", { name: "Refresh" });
  await waitFor(() => expect(refresh).toBeEnabled());
  vi.mocked(native.extensionSnapshot).mockResolvedValue(snapshot);
  fireEvent.click(refresh);
  await waitFor(() =>
    expect(screen.getByLabelText("Choose package")).toBeEnabled(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("shows a bundled app once in the installed list and opens a normal route without executing or reinstalling", async () => {
  const user = userEvent.setup();
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
  const more = await screen.findByRole("button", {
    name: "Actions for Extension Lab",
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.queryByText("Bundled app examples")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Run a tool" }),
  ).not.toBeInTheDocument();
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Open" }));
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
  const more = await screen.findByRole("button", {
    name: "Actions for Example",
  });
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Enable" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(more).toHaveFocus());
});

it("enables offline commands without optional networking and allows grants to change later", async () => {
  const user = userEvent.setup();
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
  await user.click(
    await screen.findByRole("button", { name: "Actions for Example" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Enable" }));
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
  await user.click(
    await screen.findByRole("button", { name: "Actions for Example" }),
  );
  await user.click(
    await screen.findByRole("menuitem", { name: "Permissions" }),
  );
  const permissions = await screen.findByRole("dialog");
  fireEvent.click(
    within(permissions).getByRole("checkbox", {
      name: en["ext.selectAllOptionalPermissions"],
    }),
  );
  fireEvent.click(within(permissions).getByRole("button", { name: "Save" }));
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
  marketPage("discover");
  const check = await screen.findByRole("button", {
    name: "Built-in updates",
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

it("updates a newer bundled lab without repeated consent using the captured revision", async () => {
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
  marketPage("discover");
  const check = await screen.findByRole("button", {
    name: "Built-in updates",
  });
  await waitFor(() => expect(check).toBeEnabled());
  fireEvent.click(check);
  await waitFor(() =>
    expect(native.installExtension).toHaveBeenCalledWith(
      "demo-package",
      23,
      true,
      bundledLab.sha256,
      undefined,
    ),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(native.setExtensionEnabled).not.toHaveBeenCalled();
});

it.each([
  [
    "3.0.0",
    bundledLab.sha256,
    "The installed version is newer and was retained.",
  ],
  [
    "2.0.0",
    "a".repeat(64),
    "The installed package differs from the bundled package at the same version.",
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
    marketPage("discover");
    const check = await screen.findByRole("button", {
      name: "Built-in updates",
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

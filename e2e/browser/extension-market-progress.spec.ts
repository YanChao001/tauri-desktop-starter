/// <reference lib="dom" />
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import appConfig from "../../app.config.json" with { type: "json" };
import type {
  ExtensionConsent,
  ExtensionInfo,
  ExtensionSnapshot,
  MarketDownloadProgress,
  MarketEntry,
  MarketSnapshot,
  MarketSource,
} from "../../src/lib/generated/bindings";

type MarketFixture = {
  progress: (value: MarketDownloadProgress) => void;
  finishDownload: () => void;
  finishInstall: () => void;
  finishReload: () => void;
  snapshot: () => ExtensionSnapshot;
  reloadWaiting: boolean;
  reviewOpenCount: number;
  installCalls: {
    consent: ExtensionConsent | null;
    replaceExisting: boolean;
    expectedRevision: number;
    expectedSha256: string;
  }[];
  unexpectedCommands: string[];
};
declare global {
  interface Window {
    marketProgressFixture: MarketFixture;
  }
}

const entry: MarketEntry = {
  package: {
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "fixture.market-progress",
      name: "Market progress fixture",
      version: "1.0.0",
      author: "Browser test fixture",
      description: "Controlled download and installation for layout checks.",
      commands: [],
      permissions: [],
      optionalPermissions: [],
      network: [],
    },
    sha256: "a".repeat(64),
    bytes: 1000,
  },
  category: "tools",
  featured: true,
  releaseTag: "fixture-1",
  asset: "fixture.starter-extension.json",
  packageSha256: "b".repeat(64),
  packageBytes: 1000,
};
const neighbor: MarketEntry = {
  ...entry,
  package: {
    ...entry.package,
    manifest: {
      ...entry.package.manifest,
      id: "fixture.neighbor",
      name: "Neighbor fixture",
    },
  },
};
const source: MarketSource = {
  repository: "fixture/market",
  publicKeyFingerprint: "c".repeat(64),
  catalogRevision: 1,
  packageSha256: entry.packageSha256,
};
const market: MarketSnapshot = {
  catalog: {
    schemaVersion: 2,
    revision: 1,
    repository: source.repository,
    issuedAt: 1,
    expiresAt: 9999999999,
    entries: [entry, neighbor],
  },
  hostVersion: "1.0.0",
  fetchedAt: 1,
  incompatibleEntries: [],
  stale: false,
};

async function seedNativeFixture(
  page: Page,
  theme: "light" | "dark",
  options: {
    language?: "en" | "zh";
    fontSize?: "md" | "lg";
    item?: MarketEntry;
    entries?: MarketEntry[];
    installed?: ExtensionInfo[];
    delayedReload?: boolean;
  } = {},
) {
  // This is an IPC fixture for real browser rendering, not native verification.
  await page.addInitScript(
    ({
      namespace,
      settings,
      catalog,
      item,
      receipt,
      initialItems,
      delayedReload,
    }) => {
      localStorage.setItem(`${namespace}:settings`, JSON.stringify(settings));
      const callbacks = new Map<number, (value: unknown) => void>();
      let nextCallback = 1;
      let progressCallback = 0;
      let progressIndex = 0;
      let completeDownload: (() => void) | undefined;
      let completeInstall: (() => void) | undefined;
      let installedItems = initialItems;
      let revision = initialItems.length ? 1 : 0;
      let holdReload = false;
      let completeReload: (() => void) | undefined;
      const installCalls: MarketFixture["installCalls"] = [];
      const unexpectedCommands: string[] = [];
      const snapshot = (): ExtensionSnapshot => ({
        revision,
        runs: [],
        items: installedItems,
      });
      const fixture: MarketFixture = {
        unexpectedCommands,
        installCalls,
        snapshot,
        reloadWaiting: false,
        reviewOpenCount: 0,
        progress(value) {
          callbacks.get(progressCallback)?.({
            index: progressIndex++,
            message: value,
          });
        },
        finishDownload() {
          callbacks.get(progressCallback)?.({
            index: progressIndex,
            end: true,
          });
          completeDownload?.();
        },
        finishInstall() {
          const call = installCalls.at(-1);
          if (!call || !completeInstall)
            throw new Error("No installation is pending");
          const previous = installedItems.find(
            (value) => value.package.manifest.id === item.package.manifest.id,
          );
          const installed: ExtensionInfo = {
            package: item.package,
            generation: (previous?.generation ?? 0) + 1,
            enabled: call.consent ? true : (previous?.enabled ?? false),
            grantedPermissions:
              call.consent?.grantedPermissions ??
              previous?.grantedPermissions ??
              [],
            origin: { kind: "market", source: receipt },
          };
          installedItems = previous
            ? installedItems.map((value) =>
                value === previous ? installed : value,
              )
            : [...installedItems, installed];
          revision++;
          holdReload = delayedReload;
          completeInstall?.();
        },
        finishReload() {
          holdReload = false;
          completeReload?.();
        },
      };
      let reviewVisible = false;
      new MutationObserver(() => {
        const visible = !!document.querySelector(
          '[role="dialog"][data-state="open"]',
        );
        if (visible && !reviewVisible) fixture.reviewOpenCount++;
        reviewVisible = visible;
      }).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-state"],
      });
      Object.assign(window, {
        marketProgressFixture: fixture,
        __TAURI_EVENT_PLUGIN_INTERNALS__: {
          unregisterListener: (_event: string, id: number) =>
            callbacks.delete(id),
        },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main", windowLabel: "main" },
          },
          transformCallback(callback: (value: unknown) => void) {
            const id = nextCallback++;
            callbacks.set(id, callback);
            return id;
          },
          unregisterCallback: (id: number) => callbacks.delete(id),
          async invoke(command: string, args: Record<string, unknown> = {}) {
            switch (command) {
              case "plugin:event|listen":
                return args.handler;
              case "plugin:event|unlisten":
              case "plugin:notification|register_listener":
              case "plugin:notification|remove_listener":
              case "complete_frontend_startup":
              case "set_window_work_state":
              case "save_workspace_route":
              case "prepare_enabled_extensions":
                return null;
              case "plugin:window|is_maximized":
              case "plugin:window|is_fullscreen":
                return false;
              case "load_settings_snapshot":
                return { revision: 1, settings };
              case "recovery_status":
                return {
                  active: false,
                  reason: null,
                  restored: false,
                  pending: false,
                  notes: 0,
                  archiveId: null,
                };
              case "get_workspace":
                return { routes: {}, secondaryOpen: false };
              case "activation_snapshot":
                return [];
              case "workbench_task_snapshot":
                return { revision: 0, tasks: [], active: 0, queued: 0 };
              case "get_update_snapshot":
                return null;
              case "extension_snapshot":
                if (holdReload) {
                  fixture.reloadWaiting = true;
                  await new Promise<void>((resolve) => {
                    completeReload = resolve;
                  });
                  fixture.reloadWaiting = false;
                }
                return snapshot();
              case "extension_market_snapshot":
                return catalog;
              case "download_market_extension": {
                const channel = args.onProgress as { id: number };
                progressCallback = channel.id;
                progressIndex = 0;
                await new Promise<void>((resolve) => {
                  completeDownload = resolve;
                });
                return {
                  content: "verified-browser-fixture",
                  preview: item.package,
                  source: receipt,
                };
              }
              case "install_market_extension":
                installCalls.push({
                  consent: args.consent as ExtensionConsent | null,
                  replaceExisting: args.replaceExisting as boolean,
                  expectedRevision: args.expectedRevision as number,
                  expectedSha256: args.expectedSha256 as string,
                });
                await new Promise<void>((resolve) => {
                  completeInstall = resolve;
                });
                return snapshot();
              default:
                unexpectedCommands.push(command);
                throw new Error(`Unexpected IPC fixture command: ${command}`);
            }
          },
        },
      });
    },
    {
      namespace: appConfig.browserStorageNamespace,
      settings: {
        schemaVersion: 6,
        language: options.language ?? "en",
        theme,
        accent: "violet",
        motion: "reduced",
        background: "plain",
        autoCheckUpdates: false,
        fontSize: options.fontSize ?? "md",
      },
      catalog: {
        ...market,
        catalog: {
          ...market.catalog,
          revision: 2,
          entries: options.entries ?? market.catalog.entries,
        },
      },
      item: options.item ?? entry,
      receipt: {
        ...source,
        catalogRevision: 2,
        packageSha256: (options.item ?? entry).packageSha256,
      },
      initialItems: options.installed ?? [],
      delayedReload: options.delayedReload ?? false,
    },
  );
}

async function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });
}

function sameBounds(
  actual: Awaited<ReturnType<typeof bounds>>,
  expected: Awaited<ReturnType<typeof bounds>>,
) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(1);
}

const reviewedEntry: MarketEntry = {
  ...entry,
  featured: false,
  package: {
    ...entry.package,
    manifest: {
      ...entry.package.manifest,
      name: "Middle review fixture",
      permissions: ["storage"],
      optionalPermissions: ["network:https", "links:open"],
      network: [{ origin: "https://example.com", methods: ["GET"] }],
    },
  },
};

// marketplace/plugins/wallpaper-browser/extension.json 的 1.2.5 清单快照。
// 浏览器 CI 不检出子模块，固定真实元数据以覆盖四项中文权限和完整来源列表。
const wallpaperManifest: MarketEntry["package"]["manifest"] = {
  formatVersion: 3,
  apiVersion: 2,
  minHostVersion: "0.1.8",
  id: "market.wallpaper-browser",
  version: "1.2.5",
  name: "壁纸库",
  author: "Tauri Desktop Starter",
  description: "浏览在线壁纸，管理本机图库并设置应用背景。",
  icon: "image",
  commands: [
    {
      id: "browse",
      title: "壁纸库",
      function: "browse",
      inputFormat: "json",
      resultFormat: "view",
      ui: { sidebar: true, window: true, document: "main" },
      permissions: ["wallpapers:manage"],
    },
  ],
  permissions: ["wallpapers:manage"],
  optionalPermissions: [
    "network:https",
    "network:images",
    "links:open",
    "network:system-proxy",
  ],
  network: [
    { origin: "https://wp.upx8.com", methods: ["GET"] },
    { origin: "https://wallhaven.cc", methods: ["GET"] },
    { origin: "https://commons.wikimedia.org", methods: ["GET"] },
    { origin: "https://nekos.best", methods: ["GET"] },
  ],
};

function populatedCatalog(target: MarketEntry) {
  const filler = (index: number, prefix: string): MarketEntry => ({
    ...neighbor,
    featured: false,
    package: {
      ...neighbor.package,
      manifest: {
        ...neighbor.package.manifest,
        id: `fixture.${prefix.toLowerCase()}-${index}`,
        name: `${prefix} filler ${String(index).padStart(2, "0")}`,
      },
    },
  });
  return [
    ...Array.from({ length: 10 }, (_, index) => filler(index, "Alpha")),
    target,
    ...Array.from({ length: 6 }, (_, index) => filler(index, "Zulu")),
  ];
}

function installedItem(item: MarketEntry): ExtensionInfo {
  return {
    package: item.package,
    generation: 1,
    enabled: false,
    grantedPermissions: [
      ...item.package.manifest.permissions,
      ...item.package.manifest.optionalPermissions.slice(0, 1),
    ],
    origin: {
      kind: "market",
      source: { ...source, packageSha256: "e".repeat(64) },
    },
  };
}

function extensionCard(page: Page, name: string, installed = false) {
  const panel = installed
    ? page.getByRole("tabpanel", {
        name: "Installed",
        exact: true,
        includeHidden: true,
      })
    : page.getByRole("region", {
        name: "Plugin market",
        exact: true,
        includeHidden: true,
      });
  return panel.locator("article").filter({
    has: page.getByRole("heading", {
      name,
      exact: true,
      includeHidden: true,
    }),
  });
}

async function scrollPosition(card: Locator) {
  return card.evaluate((element) => ({
    scrollTop: element.closest("main")!.scrollTop,
    y: element.getBoundingClientRect().y,
  }));
}

async function settledFrames(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function expectSameScroll(
  card: Locator,
  before: Awaited<ReturnType<typeof scrollPosition>>,
) {
  const after = await scrollPosition(card);
  expect(
    Math.abs(after.scrollTop - before.scrollTop),
    "main.scrollTop",
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y), "card viewport y").toBeLessThanOrEqual(
    1,
  );
}

async function expectCardFocus(card: Locator) {
  await expect
    .poll(() =>
      card.evaluate((element) => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement &&
          element.contains(active) &&
          active.isConnected &&
          !active.matches(":disabled") &&
          !active.closest("[hidden], [inert]")
        );
      }),
    )
    .toBe(true);
}

async function finishReload(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.marketProgressFixture.reloadWaiting))
    .toBe(true);
  await page.evaluate(() => window.marketProgressFixture.finishReload());
}

async function checkReviewLayout(
  page: Page,
  review: Locator,
  testInfo: TestInfo,
  labels = {
    required: "Required permissions",
    optional: "Optional permissions",
    all: "Select all",
    requiredItem: "Save extension data",
    technical: "Technical information",
    choiceCount: 2,
  },
) {
  const required = review.getByRole("group", {
    name: labels.required,
    exact: true,
  });
  const optional = review.getByRole("group", {
    name: labels.optional,
    exact: true,
  });
  await expect(required).toBeVisible();
  await expect(optional).toBeVisible();
  await expect(review.locator("fieldset fieldset")).toHaveCount(0);
  await expect(
    required.getByText(labels.requiredItem, { exact: true }),
  ).toBeVisible();
  const all = optional.getByRole("checkbox", {
    name: labels.all,
    exact: true,
  });
  const choices = optional.locator("ul [role=checkbox]");
  await expect(all).not.toBeChecked();
  await expect(choices).toHaveCount(labels.choiceCount);
  for (const choice of await choices.all()) {
    await expect(choice).not.toBeChecked();
    await expect(choice).toHaveAccessibleName(/\S/);
    await expect(choice).toHaveAccessibleDescription(/\S/);
  }
  await choices.first().click();
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await all.focus();
  await page.keyboard.press("Space");
  for (const choice of await choices.all()) await expect(choice).toBeChecked();
  await page.keyboard.press("Space");
  for (const choice of await choices.all())
    await expect(choice).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(all).toBeChecked();
  const technical = review.locator("details").filter({
    has: page.locator("summary", { hasText: labels.technical }),
  });
  await technical.locator("summary").click();
  const body = technical.locator(":scope > dl");
  await expect(body).toBeVisible();
  await expect(
    technical.locator("fieldset, [data-slot=card], pre, code"),
  ).toHaveCount(0);
  const padding = await body.evaluate((element) => {
    const style = getComputedStyle(element);
    const first = element.querySelector("dt")!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      left: parseFloat(style.paddingLeft),
      right: parseFloat(style.paddingRight),
      inset: first.left - box.left,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
  expect(padding.left).toBeGreaterThanOrEqual(padding.rem * 0.75 - 0.5);
  expect(padding.right).toBeGreaterThanOrEqual(padding.rem * 0.75 - 0.5);
  expect(padding.inset).toBeGreaterThanOrEqual(padding.left - 1);
  const text = await review.textContent();
  expect(text).not.toMatch(/SHA-256|[a-f0-9]{64}/i);
  await settledFrames(page);
  const layout = await review.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      overflow: element.scrollWidth - element.clientWidth,
      width: innerWidth,
      height: innerHeight,
    };
  });
  expect(layout.left).toBeGreaterThanOrEqual(-1);
  expect(layout.right).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.top).toBeGreaterThanOrEqual(-1);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height + 1);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  const scan = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await review.evaluate((element) => {
    element.scrollTop = 0;
  });
  await settledFrames(page);
  await review.screenshot({
    path: testInfo.outputPath("review-permissions.png"),
  });
  await review.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await settledFrames(page);
  await review.screenshot({
    path: testInfo.outputPath("review-technical.png"),
  });
}

for (const width of [880, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`market progress stays inside its stable button at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedNativeFixture(page, theme);
      await page.goto("./#/extensions?tab=discover");
      const marketSection = page.getByRole("region", {
        name: "Plugin market",
        exact: true,
        includeHidden: true,
      });
      const card = marketSection.locator("article").filter({
        has: page.getByRole("heading", {
          name: entry.package.manifest.name,
          includeHidden: true,
        }),
      });
      const adjacent = marketSection.locator("article").filter({
        has: page.getByRole("heading", {
          name: neighbor.package.manifest.name,
          includeHidden: true,
        }),
      });
      const button = card.getByRole("button", { name: "Install" });
      await expect(button).toBeEnabled();
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const stableButton = card.locator("button").last();
      const originalButton = await bounds(stableButton);
      const originalCard = await bounds(card);
      const originalNeighbor = await bounds(adjacent);
      await button.click();
      await expect(stableButton).toHaveAttribute("aria-busy", "true");

      for (const percent of [25, 80]) {
        await page.evaluate((receivedBytes) => {
          window.marketProgressFixture.progress({
            phase: "downloading",
            receivedBytes,
            totalBytes: 1000,
          });
        }, percent * 10);
        await expect(stableButton).toHaveAccessibleName(
          `Downloading ${percent}%`,
        );
        await expect(marketSection.getByRole("progressbar")).toHaveAttribute(
          "aria-valuenow",
          String(percent),
        );
        const fillElement = stableButton.locator(
          '[data-slot="market-download-progress"]',
        );
        await expect
          .poll(async () => {
            const fill = await bounds(fillElement);
            const control = await bounds(stableButton);
            return Math.abs(fill.width / control.width - percent / 100);
          })
          .toBeLessThan(0.02);
        const fill = await bounds(fillElement);
        const control = await bounds(stableButton);
        expect(fill.x).toBeGreaterThanOrEqual(control.x);
        expect(fill.y).toBeGreaterThanOrEqual(control.y);
        expect(fill.x + fill.width).toBeLessThanOrEqual(
          control.x + control.width,
        );
        expect(fill.y + fill.height).toBeLessThanOrEqual(
          control.y + control.height,
        );
        expect(
          Math.abs(fill.width / control.width - percent / 100),
        ).toBeLessThan(0.02);
        sameBounds(control, originalButton);
        sameBounds(await bounds(card), originalCard);
        sameBounds(await bounds(adjacent), originalNeighbor);
      }
      const scan = await new AxeBuilder({ page })
        .include('section[aria-label="Plugin market"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath("download-progress.png"),
      });

      await page.evaluate(() => {
        window.marketProgressFixture.progress({
          phase: "verifying",
        });
      });
      await expect(stableButton).toHaveAccessibleName("Verifying…");
      sameBounds(await bounds(stableButton), originalButton);
      sameBounds(await bounds(adjacent), originalNeighbor);
      await page.evaluate(() => window.marketProgressFixture.finishDownload());
      const review = page.getByRole("dialog", {
        name: "Install extension",
      });
      await expect(review).toBeVisible();
      await review
        .getByRole("button", { name: "Install", exact: true })
        .click();
      await expect(stableButton).toHaveAttribute("aria-busy", "true");
      await expect(
        marketSection.getByRole("progressbar", { includeHidden: true }),
      ).toHaveAttribute("aria-valuetext", "Installing…");
      await expect(
        stableButton.locator('[data-slot="market-download-progress"]'),
      ).toBeAttached();
      await expect
        .poll(async () => {
          const fill = await bounds(
            stableButton.locator('[data-slot="market-download-progress"]'),
          );
          const control = await bounds(stableButton);
          return Math.abs(fill.width / control.width - 1);
        })
        .toBeLessThan(0.02);
      sameBounds(await bounds(stableButton), originalButton);
      sameBounds(await bounds(adjacent), originalNeighbor);
      await page.evaluate(() => window.marketProgressFixture.finishInstall());
      await expect(review).toBeHidden();
      await expect(stableButton).toHaveAccessibleName("Installed");
      await expect(
        stableButton.locator('[data-slot="market-download-progress"]'),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => window.marketProgressFixture.unexpectedCommands,
        ),
      ).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const profile of [
    { width: 880, fontSize: "md" },
    { width: 390, fontSize: "lg" },
  ] as const) {
    test(`low market installation retains scroll and card focus with accessible review at ${profile.width}px ${profile.fontSize} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: profile.width, height: 740 });
      await seedNativeFixture(page, theme, {
        ...profile,
        item: reviewedEntry,
        entries: populatedCatalog(reviewedEntry),
        delayedReload: true,
      });
      await page.goto("./#/extensions?tab=discover");
      await expect(page.locator("html")).toHaveAttribute(
        "data-font-size",
        profile.fontSize,
      );
      await expect
        .poll(() =>
          page
            .locator("html")
            .evaluate((element) => element.classList.contains("dark")),
        )
        .toBe(theme === "dark");
      const card = extensionCard(page, reviewedEntry.package.manifest.name);
      const download = card.getByRole("button", {
        name: "Install",
        exact: true,
      });
      await download.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await settledFrames(page);
      const original = await scrollPosition(card);
      expect(original.scrollTop).toBeGreaterThan(300);
      await download.click();
      await expect(card.locator("button").last()).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await page.evaluate(() => window.marketProgressFixture.finishDownload());
      const review = page.getByRole("dialog", {
        name: "Install extension",
      });
      await expect(review).toBeVisible();
      expect(
        await page.evaluate(() => window.marketProgressFixture.installCalls),
      ).toEqual([]);
      await checkReviewLayout(page, review, testInfo);
      await review
        .getByRole("button", { name: "Install", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => window.marketProgressFixture.installCalls.length),
        )
        .toBe(1);
      const call = await page.evaluate(
        () => window.marketProgressFixture.installCalls[0],
      );
      expect(call).toEqual({
        consent: {
          trusted: true,
          grantedPermissions: ["storage", "network:https", "links:open"],
        },
        replaceExisting: false,
        expectedRevision: 0,
        expectedSha256: reviewedEntry.package.sha256,
      });
      await page.evaluate(() => window.marketProgressFixture.finishInstall());
      await expect
        .poll(() =>
          page.evaluate(() => window.marketProgressFixture.reloadWaiting),
        )
        .toBe(true);
      await expect(review).toBeVisible();
      await expectSameScroll(card, original);
      await finishReload(page);
      await expect(review).toBeHidden();
      const installed = card.getByRole("button", {
        name: "Installed",
        exact: true,
      });
      await expect(installed).toBeDisabled();
      await settledFrames(page);
      await expectSameScroll(card, original);
      await expectCardFocus(card);
      expect(
        await page.evaluate(
          () => window.marketProgressFixture.unexpectedCommands,
        ),
      ).toEqual([]);
    });
  }
}

for (const changedPermissions of [false, true]) {
  test(`low installed update ${changedPermissions ? "reviews changed permissions and restores cancel focus" : "reuses consent without a dialog"} across delayed reload`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 880, height: 740 });
    const update: MarketEntry = {
      ...reviewedEntry,
      package: {
        ...reviewedEntry.package,
        sha256: "d".repeat(64),
        manifest: {
          ...reviewedEntry.package.manifest,
          version: "2.0.0",
          permissions: changedPermissions
            ? ["storage", "text:read"]
            : ["storage"],
        },
      },
    };
    const entries = populatedCatalog(update);
    const initial = entries.map((value) =>
      installedItem(
        value.package.manifest.id === entry.package.manifest.id
          ? reviewedEntry
          : value,
      ),
    );
    await seedNativeFixture(page, "dark", {
      item: update,
      entries,
      installed: initial,
      delayedReload: true,
    });
    await page.goto("./#/extensions");
    const card = extensionCard(page, reviewedEntry.package.manifest.name, true);
    const more = card.getByRole("button", {
      name: `Actions for ${reviewedEntry.package.manifest.name}`,
      exact: true,
    });
    await more.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await settledFrames(page);
    const original = await scrollPosition(card);
    expect(original.scrollTop).toBeGreaterThan(300);
    const downloadUpdate = async () => {
      await more.click();
      await page
        .getByRole("menuitem", { name: "Update to 2.0.0", exact: true })
        .click();
      await expect(more).toBeDisabled();
      await page.evaluate(() => window.marketProgressFixture.finishDownload());
    };
    await downloadUpdate();
    const review = page.getByRole("dialog", {
      name: "Install extension",
    });
    if (changedPermissions) {
      await expect(review).toBeVisible();
      expect(
        await page.evaluate(() => window.marketProgressFixture.installCalls),
      ).toEqual([]);
      await review.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(review).toBeHidden();
      await expect(more).toBeFocused();
      await settledFrames(page);
      await expectSameScroll(card, original);
      await downloadUpdate();
      await expect(review).toBeVisible();
      const optional = review.getByRole("group", {
        name: "Optional permissions",
        exact: true,
      });
      await expect(
        optional.getByRole("checkbox", {
          name: "Access declared services",
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        optional.getByRole("checkbox", { name: "Open web pages", exact: true }),
      ).not.toBeChecked();
      await review.getByRole("button", { name: "Update", exact: true }).click();
    }
    await expect
      .poll(() =>
        page.evaluate(() => window.marketProgressFixture.installCalls.length),
      )
      .toBe(1);
    const call = await page.evaluate(
      () => window.marketProgressFixture.installCalls[0],
    );
    expect(call).toEqual({
      consent: changedPermissions
        ? {
            trusted: true,
            grantedPermissions: ["storage", "text:read", "network:https"],
          }
        : null,
      replaceExisting: true,
      expectedRevision: 1,
      expectedSha256: update.package.sha256,
    });
    if (!changedPermissions) {
      await expect(review).toHaveCount(0);
      expect(
        await page.evaluate(() => window.marketProgressFixture.reviewOpenCount),
      ).toBe(0);
    }
    await page.evaluate(() => window.marketProgressFixture.finishInstall());
    await expect
      .poll(() =>
        page.evaluate(() => window.marketProgressFixture.reloadWaiting),
      )
      .toBe(true);
    await expectSameScroll(card, original);
    await finishReload(page);
    await expect(review).toBeHidden();
    await expect(more).toBeEnabled();
    await settledFrames(page);
    await expectSameScroll(card, original);
    await expectCardFocus(card);
    const installed = await page.evaluate(
      (id) =>
        window.marketProgressFixture
          .snapshot()
          .items.find((item) => item.package.manifest.id === id),
      entry.package.manifest.id,
    );
    expect(installed?.package.manifest.version).toBe("2.0.0");
    expect(installed?.enabled).toBe(changedPermissions);
    expect(installed?.grantedPermissions).toEqual(
      changedPermissions
        ? ["storage", "text:read", "network:https"]
        : ["storage", "network:https"],
    );
    expect(
      await page.evaluate(
        () => window.marketProgressFixture.unexpectedCommands,
      ),
    ).toEqual([]);
  });
}

test("Chinese wallpaper review keeps all four optional permissions readable at 390px large dark", async ({
  page,
}, testInfo) => {
  const wallpaper: MarketEntry = {
    ...entry,
    package: { ...entry.package, manifest: wallpaperManifest },
  };
  await page.setViewportSize({ width: 390, height: 740 });
  await seedNativeFixture(page, "dark", {
    language: "zh",
    fontSize: "lg",
    item: wallpaper,
    entries: [wallpaper],
  });
  await page.goto("./#/extensions?tab=discover");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-font-size", "lg");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: "壁纸库", exact: true }),
  });
  await card.getByRole("button").click();
  await expect(card.locator("button")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => window.marketProgressFixture.finishDownload());
  const review = page.getByRole("dialog", { name: "安装扩展", exact: true });
  await expect(review).toBeVisible();
  const optional = review.getByRole("group", { name: "可选权限", exact: true });
  for (const name of [
    "访问指定网络服务",
    "下载网络图片",
    "打开网页",
    "使用系统代理",
  ]) {
    const checkbox = optional.getByRole("checkbox", { name, exact: true });
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveAccessibleDescription(/\S/);
    const descriptionFits = await checkbox.evaluate((element) => {
      const row = element.closest("li")!;
      const description = document.getElementById(
        element.getAttribute("aria-describedby")!,
      )!;
      return (
        description.textContent!.trim().length > 10 &&
        row.scrollWidth <= row.clientWidth + 1 &&
        description.scrollHeight <= description.clientHeight + 1
      );
    });
    expect(descriptionFits, name).toBe(true);
  }
  await checkReviewLayout(page, review, testInfo, {
    required: "必需权限",
    optional: "可选权限",
    all: "全选",
    requiredItem: "管理图库与应用背景",
    technical: "技术信息",
    choiceCount: 4,
  });
  const install = review.getByRole("button", {
    name: "安装",
    exact: true,
  });
  const cancel = review.getByRole("button", { name: "取消", exact: true });
  await expect(install).toBeInViewport();
  await expect(cancel).toBeInViewport();
  expect(
    await page.evaluate(() => window.marketProgressFixture.installCalls),
  ).toEqual([]);
  await cancel.click();
  await expect(review).toBeHidden();
  expect(
    await page.evaluate(() => window.marketProgressFixture.unexpectedCommands),
  ).toEqual([]);
});

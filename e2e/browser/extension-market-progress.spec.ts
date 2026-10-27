/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import appConfig from "../../app.config.json" with { type: "json" };
import type {
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

async function seedNativeFixture(page: Page, theme: "light" | "dark") {
  // This is an IPC fixture for real browser rendering, not native verification.
  await page.addInitScript(
    ({ namespace, settings, catalog, item, receipt }) => {
      localStorage.setItem(`${namespace}:settings`, JSON.stringify(settings));
      const callbacks = new Map<number, (value: unknown) => void>();
      let nextCallback = 1;
      let progressCallback = 0;
      let progressIndex = 0;
      let completeDownload: (() => void) | undefined;
      let completeInstall: (() => void) | undefined;
      let installed = false;
      const unexpectedCommands: string[] = [];
      const snapshot = (): ExtensionSnapshot => ({
        revision: installed ? 1 : 0,
        runs: [],
        items: installed
          ? [
              {
                package: item.package,
                generation: 1,
                enabled: true,
                grantedPermissions: [],
                origin: { kind: "market", source: receipt },
              },
            ]
          : [],
      });
      const fixture: MarketFixture = {
        unexpectedCommands,
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
          installed = true;
          completeInstall?.();
        },
      };
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
        schemaVersion: 3,
        language: "en",
        theme,
        accent: "violet",
        motion: "reduced",
        background: "plain",
        autoCheckUpdates: false,
      },
      catalog: market,
      item: entry,
      receipt: source,
    },
  );
}

async function bounds(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const main = element.closest("main");
    return {
      x: box.x + (main?.scrollLeft ?? 0),
      y: box.y + (main?.scrollTop ?? 0),
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

for (const width of [880, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`market progress stays inside its stable button at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedNativeFixture(page, theme);
      await page.goto("./#/extensions?tab=discover");
      const marketSection = page.getByRole("region", {
        name: "Official plugin market",
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
      const button = card.getByRole("button", { name: "Download and review" });
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
        .include('section[aria-label="Official plugin market"]')
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
        name: "Review extension package",
      });
      await expect(review).toBeVisible();
      await review
        .getByRole("button", { name: "Install and enable", exact: true })
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
      await expect(stableButton).toHaveAccessibleName(
        "This version is installed",
      );
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

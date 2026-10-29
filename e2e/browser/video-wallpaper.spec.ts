/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import appConfig from "../../app.config.json" with { type: "json" };

const KEY = `${appConfig.browserStorageNamespace}:settings`;

async function openSettings(page: Page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          language: "en",
          theme: "dark",
          motion: "full",
          background: "plain",
          backgroundIntensity: 50,
        }),
      );
  }, KEY);
  await page.goto("./#/settings");
  await expect(
    page.getByRole("button", {
      name: "Add video",
      exact: true,
    }),
  ).toBeEnabled();
}

/** 录制真实的本地 WebM；首帧相同，后续画面不同，用于验证视频身份不依赖封面。 */
async function videoFile(page: Page, name: string, finalColor: string) {
  const bytes = await page.evaluate(async (color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#669c88";
    context.fillRect(0, 0, 160, 90);
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
      videoBitsPerSecond: 128_000,
    });
    const chunks: Blob[] = [];
    const recorded = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onerror = () =>
        reject(new Error("Video fixture recording failed"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });
    recorder.start();
    let frame = 0;
    const timer = setInterval(() => {
      if (++frame > 2) {
        context.fillStyle = color;
        context.fillRect(0, 0, 160, 90);
      }
      if (frame === 8) {
        clearInterval(timer);
        recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      }
    }, 50);
    return [...new Uint8Array(await (await recorded).arrayBuffer())];
  }, finalColor);
  return { name, mimeType: "video/webm", buffer: Buffer.from(bytes) };
}

function currentVideo(page: Page) {
  return page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value.customBackground?.video?.id as string | undefined;
  }, KEY);
}

test("video wallpapers keep a local cover and reference across reload and pause with motion and transparency", async ({
  page,
}, testInfo) => {
  await openSettings(page);
  const file = await videoFile(page, "clouds.webm", "#6c83bc");
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(
    page.getByRole("radio", {
      name: "Use wallpaper: clouds.webm",
      exact: true,
    }),
  ).toBeChecked();
  const selected = await currentVideo(page);
  expect(selected).toMatch(/^[a-f0-9]{64}$/);
  const snapshot = await page.evaluate(
    (key) => localStorage.getItem(key)!,
    KEY,
  );
  expect(snapshot.length).toBeLessThan(128 * 1024);
  expect(snapshot).not.toContain("blob:");
  expect(snapshot).not.toContain("data:video/");
  const video = page.locator("[data-custom-background-video]");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((node) => !(node as HTMLVideoElement).paused))
    .toBe(true);
  await expect
    .poll(() =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("radio", {
      name: "Use wallpaper: clouds.webm",
      exact: true,
    }),
  ).toBeChecked();
  expect(await currentVideo(page)).toBe(selected);
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((node) => !(node as HTMLVideoElement).paused))
    .toBe(true);
  const slider = page.getByRole("slider", {
    name: "Background transparency",
    exact: true,
  });
  await slider.press("Home");
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused))
    .toBe(true);
  await slider.press("ArrowRight");
  await expect
    .poll(() => video.evaluate((node) => !(node as HTMLVideoElement).paused))
    .toBe(true);
  await slider.press("End");
  await page.getByRole("combobox", { name: "Font", exact: true }).click();
  await expect(page.locator('[data-slot="select-content"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await page.locator('[data-slot="select-content"]').evaluate(async (node) => {
    await Promise.all(
      node.getAnimations().map((animation) => animation.finished),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    path: testInfo.outputPath("video-wallpaper-frost.png"),
  });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused))
    .toBe(true);
  await expect(page.locator("[data-custom-background]")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() => video.evaluate((node) => !(node as HTMLVideoElement).paused))
    .toBe(true);
  await page
    .getByRole("button", { name: "Clear background", exact: true })
    .click();
  await expect(page.locator("[data-custom-background-video]")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-background",
    "plain",
  );
});

test("different videos with the same cover select independently and deleting another video preserves the current wallpaper", async ({
  page,
}) => {
  await openSettings(page);
  const first = await videoFile(page, "first.webm", "#657eb2");
  const second = await videoFile(page, "second.webm", "#b87d64");
  await page.locator('input[type="file"]').setInputFiles([first, second]);
  await expect(page.locator(".wallpaper-card")).toHaveCount(2);
  const firstChoice = page.getByRole("radio", {
    name: "Use wallpaper: first.webm",
    exact: true,
  });
  const secondChoice = page.getByRole("radio", {
    name: "Use wallpaper: second.webm",
    exact: true,
  });
  await expect(secondChoice).toBeChecked();
  await expect(firstChoice).not.toBeChecked();
  const secondId = await currentVideo(page);
  const secondCover = await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value.customBackground?.dataUrl as string;
  }, KEY);
  await firstChoice.locator("..").click();
  await expect(firstChoice).toBeChecked();
  await expect(secondChoice).not.toBeChecked();
  const firstId = await currentVideo(page);
  expect(firstId).not.toBe(secondId);
  expect(
    await page.evaluate((key) => {
      const value = JSON.parse(localStorage.getItem(key) ?? "{}");
      return value.customBackground?.dataUrl as string;
    }, KEY),
  ).toBe(secondCover);
  await page
    .getByRole("button", { name: "Delete wallpaper: second.webm", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Remove wallpaper from library?" })
    .getByRole("button", { name: "Remove wallpaper", exact: true })
    .click();
  await expect(page.locator(".wallpaper-card")).toHaveCount(1);
  await expect(firstChoice).toBeChecked();
  expect(await currentVideo(page)).toBe(firstId);
});

test("video cleanup preserves current and pending media and refuses to infer orphans from future libraries", async ({
  page,
}) => {
  await openSettings(page);
  const first = await videoFile(page, "retained.webm", "#657eb2");
  const second = await videoFile(page, "new.webm", "#b87d64");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(first);
  await expect(
    page.getByRole("radio", {
      name: "Use wallpaper: retained.webm",
      exact: true,
    }),
  ).toBeChecked();
  const retained = (await currentVideo(page))!;
  const oldId = "c".repeat(64);
  const pendingId = "d".repeat(64);
  const databaseName = `${appConfig.browserStorageNamespace}:wallpaper-videos`;
  const seedMedia = async () =>
    page.evaluate(
      ({ databaseName, retained, oldId, pendingId }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(databaseName, 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction("videos", "readwrite");
            const store = transaction.objectStore("videos");
            const read = store.get(retained);
            read.onsuccess = () => {
              const entry = read.result as {
                id: string;
                mime: string;
                blob: Blob;
                createdAt: number;
              };
              store.put({ ...entry, createdAt: Date.now() - 700_000 });
              store.put({
                ...entry,
                id: oldId,
                createdAt: Date.now() - 700_000,
              });
              store.put({ ...entry, id: pendingId, createdAt: Date.now() });
            };
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
      { databaseName, retained, oldId, pendingId },
    );
  const keys = () =>
    page.evaluate(
      (databaseName) =>
        new Promise<IDBValidKey[]>((resolve, reject) => {
          const open = indexedDB.open(databaseName, 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction("videos", "readonly");
            const read = transaction.objectStore("videos").getAllKeys();
            transaction.oncomplete = () => {
              db.close();
              resolve(read.result);
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
      databaseName,
    );
  await seedMedia();
  await input.setInputFiles(second);
  await expect(
    page.getByRole("radio", { name: "Use wallpaper: new.webm", exact: true }),
  ).toBeChecked();
  const active = await currentVideo(page);
  const cleaned = await keys();
  expect(cleaned).toContain(retained);
  expect(cleaned).toContain(active);
  expect(cleaned).toContain(pendingId);
  expect(cleaned).not.toContain(oldId);
  await seedMedia();
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction("library", "readwrite");
          const store = transaction.objectStore("library");
          const read = store.get("snapshot");
          read.onsuccess = () =>
            store.put({ ...read.result, version: 3 }, "snapshot");
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
    `${appConfig.browserStorageNamespace}:wallpapers`,
  );
  await input.setInputFiles(first);
  await expect(
    page.locator('[data-sonner-toast][data-type="error"]'),
  ).toBeVisible();
  expect(await currentVideo(page)).toBe(active);
  expect(await keys()).toContain(oldId);
});

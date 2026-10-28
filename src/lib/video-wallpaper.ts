import {
  importBackgroundImage,
  normalizeWallpaperVideo,
  type CustomBackground,
} from "@/lib/background-image";
import {
  chooseWallpaperVideo,
  isTauri,
  wallpaperVideoUrl,
  type WallpaperVideo,
} from "@/lib/tauri";
import { APP_CONFIG } from "@/config/app";
import { readInitialSettings } from "@/lib/settings-model";
import { listWallpaperLibrary } from "@/lib/wallpaper-library";

export const MAX_WALLPAPER_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_LIBRARY_VIDEO_BYTES = 512 * 1024 * 1024;
const DATABASE = `${APP_CONFIG.browserStorageNamespace}:wallpaper-videos`;
const STORE = "videos";

export class BackgroundVideoError extends Error {
  constructor(
    readonly code: "videoType" | "videoSize" | "videoDecode" | "videoStorage",
  ) {
    super(`Video wallpaper: ${code}`);
  }
}

type StoredVideo = {
  id: string;
  mime: WallpaperVideo["mime"];
  blob: Blob;
  createdAt: number;
};

function storedVideo(value: unknown): StoredVideo {
  const reference = normalizeWallpaperVideo(value);
  if (
    !reference ||
    typeof value !== "object" ||
    value === null ||
    !("blob" in value) ||
    !(value.blob instanceof Blob) ||
    value.blob.size <= 0 ||
    value.blob.size > MAX_WALLPAPER_VIDEO_BYTES ||
    value.blob.type !== reference.mime ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt <= 0
  )
    throw new BackgroundVideoError("videoStorage");
  return { ...reference, blob: value.blob, createdAt: value.createdAt };
}

async function browserVideoReferences(): Promise<Set<string> | null> {
  const current = readInitialSettings();
  if (current.error) return null;
  try {
    const wallpapers = await listWallpaperLibrary(null);
    const references = new Set(
      wallpapers.flatMap((wallpaper) =>
        wallpaper.video ? [wallpaper.video.id] : [],
      ),
    );
    if (current.settings.customBackground?.video)
      references.add(current.settings.customBackground.video.id);
    return references;
  } catch {
    // 未知或损坏的目录不能用于判断视频已失去引用。
    return null;
  }
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onerror = () => reject(new BackgroundVideoError("videoStorage"));
    request.onblocked = () => {
      blocked = true;
      reject(new BackgroundVideoError("videoStorage"));
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function saveBrowserVideo(video: WallpaperVideo, blob: Blob) {
  const references = await browserVideoReferences();
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const raw: unknown = request.result;
        if (!Array.isArray(raw)) throw new BackgroundVideoError("videoStorage");
        const cutoff = Date.now() - 10 * 60 * 1000;
        const entries = raw.map(storedVideo).filter((entry) => {
          if (
            references &&
            entry.id !== video.id &&
            !references.has(entry.id) &&
            entry.createdAt < cutoff
          ) {
            store.delete(entry.id);
            return false;
          }
          return true;
        });
        const existing = entries.find((entry) => entry.id === video.id);
        if (existing) {
          // 重新导入与另一个窗口的孤儿回收交错时，先续期再提交图库引用。
          store.put({
            ...existing,
            createdAt: Date.now(),
          } satisfies StoredVideo);
        } else {
          const bytes = entries.reduce(
            (total, entry) => total + entry.blob.size,
            0,
          );
          if (bytes + blob.size > MAX_LIBRARY_VIDEO_BYTES)
            throw new BackgroundVideoError("videoStorage");
          store.put({
            ...video,
            blob,
            createdAt: Date.now(),
          } satisfies StoredVideo);
        }
      } catch (reason) {
        failure = reason;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      reject(failure ?? new BackgroundVideoError("videoStorage"));
    };
    transaction.onerror = () => {};
  });
}

async function browserVideoBlob(video: WallpaperVideo): Promise<Blob> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(video.id);
    let result: Blob;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const stored = storedVideo(request.result as unknown);
        if (stored.mime !== video.mime)
          throw new BackgroundVideoError("videoStorage");
        result = stored.blob;
      } catch (reason) {
        failure = reason;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onabort = () => {
      db.close();
      reject(failure ?? new BackgroundVideoError("videoStorage"));
    };
    transaction.onerror = () => {};
  });
}

/** 播放地址属于当前窗口的临时资源，不进入设置或图库。 */
export async function resolveWallpaperVideo(
  video: WallpaperVideo,
): Promise<{ url: string; release: () => void }> {
  if (!normalizeWallpaperVideo(video))
    throw new BackgroundVideoError("videoType");
  if (isTauri())
    return { url: await wallpaperVideoUrl(video), release: () => {} };
  const url = URL.createObjectURL(await browserVideoBlob(video));
  return { url, release: () => URL.revokeObjectURL(url) };
}

function readFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: BackgroundVideoError) => {
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new BackgroundVideoError("videoDecode")),
      20_000,
    );
    video.onloadeddata = () => finish();
    video.onerror = () => finish(new BackgroundVideoError("videoDecode"));
    video.load();
  });
}

async function videoPoster(
  url: string,
  name: string,
): Promise<CustomBackground> {
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = url;
  try {
    await readFrame(video);
    if (
      Number.isNaN(video.duration) ||
      video.duration <= 0 ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0 ||
      video.videoWidth * video.videoHeight > 100_000_000
    )
      throw new BackgroundVideoError("videoDecode");
    const scale = Math.min(
      1,
      1600 / Math.max(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new BackgroundVideoError("videoDecode");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new BackgroundVideoError("videoDecode")),
        "image/jpeg",
        0.92,
      ),
    );
    return await importBackgroundImage(
      new File([blob], name, { type: "image/jpeg" }),
    );
  } catch (reason) {
    if (reason instanceof BackgroundVideoError) throw reason;
    throw new BackgroundVideoError("videoDecode");
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    canvas.width = canvas.height = 0;
  }
}

function fileVideoMime(file: File): WallpaperVideo["mime"] {
  if (file.type === "video/mp4" || file.type === "video/webm") return file.type;
  if (!file.type && /\.mp4$/i.test(file.name)) return "video/mp4";
  if (!file.type && /\.webm$/i.test(file.name)) return "video/webm";
  throw new BackgroundVideoError("videoType");
}

/** 先实际解码封面，再持久保存视频；取消或失败保留已有背景。 */
export async function importVideoWallpaper(
  file?: File,
): Promise<CustomBackground | null> {
  if (isTauri()) {
    let selected;
    try {
      selected = await chooseWallpaperVideo();
    } catch (reason) {
      if (
        typeof reason === "object" &&
        reason !== null &&
        "code" in reason &&
        reason.code === "INPUT_TOO_LONG"
      )
        throw new BackgroundVideoError("videoSize");
      throw new BackgroundVideoError("videoStorage");
    }
    if (!selected) return null;
    const source = await resolveWallpaperVideo(selected.video);
    try {
      return {
        ...(await videoPoster(source.url, selected.name)),
        video: selected.video,
      };
    } finally {
      source.release();
    }
  }
  if (!file) return null;
  const mime = fileVideoMime(file);
  if (file.size <= 0 || file.size > MAX_WALLPAPER_VIDEO_BYTES)
    throw new BackgroundVideoError("videoSize");
  const blob = file.type === mime ? file : new Blob([file], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const poster = await videoPoster(url, file.name);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    const id = [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const video: WallpaperVideo = { id, mime };
    await saveBrowserVideo(video, blob);
    return { ...poster, video };
  } finally {
    URL.revokeObjectURL(url);
  }
}

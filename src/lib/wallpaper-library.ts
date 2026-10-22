import { normalizeBackgroundImage } from "@/lib/background-image";
import * as desktop from "@/lib/tauri";
import type { Wallpaper, WallpaperInput } from "@/lib/tauri";

export type { Wallpaper } from "@/lib/tauri";
export const MAX_WALLPAPERS = 24;
const DATABASE = "tauri-starter:wallpapers";
const STORE = "library";
const CHANNEL = "tauri-starter:wallpapers-changed";
type Library = { version: 1; images: Wallpaper[] };

export class WallpaperLibraryError extends Error {
  constructor(readonly code: "full" | "invalid" | "storage") {
    super("Wallpaper library: " + code);
  }
}

function readLibrary(raw: unknown): Library {
  if (raw === undefined) return { version: 1, images: [] };
  if (typeof raw !== "object" || raw === null)
    throw new WallpaperLibraryError("invalid");
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.images) ||
    value.images.length > MAX_WALLPAPERS
  )
    throw new WallpaperLibraryError("invalid");
  const ids = new Set<string>();
  const images = value.images.map((item: unknown): Wallpaper => {
    const image = normalizeBackgroundImage(item);
    const id =
      typeof item === "object" && item !== null && "id" in item
        ? item.id
        : null;
    if (
      !image ||
      typeof id !== "string" ||
      !/^[a-f0-9]{64}$/.test(id) ||
      ids.has(id)
    )
      throw new WallpaperLibraryError("invalid");
    ids.add(id);
    return { id, name: image.name, dataUrl: image.dataUrl };
  });
  return { version: 1, images };
}

async function browserImage(input: WallpaperInput): Promise<Wallpaper> {
  const image = normalizeBackgroundImage(input);
  if (!image) throw new WallpaperLibraryError("invalid");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(image.dataUrl),
  );
  const id = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { id, name: image.name, dataUrl: image.dataUrl };
}

/** 一次事务内读取和修改，避免多个浏览器窗口覆盖彼此的图库。 */
function transact<T>(
  change: (library: Library, fresh: boolean) => T,
  write: boolean | "initialize",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    let blocked = false;
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(new WallpaperLibraryError("storage"));
    open.onblocked = () => {
      blocked = true;
      reject(new WallpaperLibraryError("storage"));
    };
    open.onsuccess = () => {
      const db = open.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(STORE, write ? "readwrite" : "readonly");
      } catch {
        db.close();
        reject(new WallpaperLibraryError("storage"));
        return;
      }
      const store = transaction.objectStore(STORE);
      const request = store.get("snapshot");
      let result: T;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const library = readLibrary(request.result);
          result = change(library, request.result === undefined);
          if (
            write === true ||
            (write === "initialize" && request.result === undefined)
          )
            store.put(library, "snapshot");
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        db.close();
        resolve(result);
      };
      transaction.onabort = () => {
        db.close();
        reject(failure ?? new WallpaperLibraryError("storage"));
      };
      transaction.onerror = () => {
        /* abort 统一报告错误，不能提前报告写入成功。 */
      };
    };
  });
}

function notify() {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(null);
  channel.close();
}

export async function listWallpaperLibrary(
  legacy: WallpaperInput | null,
): Promise<Wallpaper[]> {
  if (desktop.isTauri()) return desktop.listWallpapers(legacy);
  const previous = legacy ? await browserImage(legacy) : null;
  return transact((library, fresh) => {
    if (fresh && previous) library.images.push(previous);
    return library.images;
  }, "initialize");
}

export async function addLibraryWallpaper(
  input: WallpaperInput,
): Promise<Wallpaper> {
  if (desktop.isTauri()) return desktop.addWallpaper(input);
  const image = await browserImage(input);
  const result = await transact((library) => {
    const existing = library.images.find((item) => item.id === image.id);
    if (existing) return existing;
    if (library.images.length >= MAX_WALLPAPERS)
      throw new WallpaperLibraryError("full");
    library.images.push(image);
    return image;
  }, true);
  notify();
  return result;
}

export async function renameLibraryWallpaper(
  id: string,
  name: string,
): Promise<Wallpaper> {
  if (desktop.isTauri()) return desktop.renameWallpaper(id, name);
  const result = await transact((library) => {
    const image = library.images.find((item) => item.id === id);
    if (!image || !normalizeBackgroundImage({ ...image, name }))
      throw new WallpaperLibraryError("invalid");
    image.name = name;
    return image;
  }, true);
  notify();
  return result;
}

export async function removeLibraryWallpaper(id: string): Promise<void> {
  if (desktop.isTauri()) return desktop.removeWallpaper(id);
  await transact((library) => {
    library.images = library.images.filter((item) => item.id !== id);
  }, true);
  notify();
}

export async function onWallpaperLibraryChanged(
  handler: () => void,
): Promise<() => void> {
  if (desktop.isTauri()) return desktop.onWallpapersChanged(handler);
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = handler;
  return () => channel.close();
}

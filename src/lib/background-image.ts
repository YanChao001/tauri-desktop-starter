import type { WallpaperVideo } from "@/lib/tauri";

export const MAX_BACKGROUND_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_BACKGROUND_DATA_LENGTH = 96 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_SOURCE_IMAGE_EDGE = 32_768;
const MAX_IMAGE_EDGE = 1600;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DATA_PREFIXES = ["data:image/webp;base64,", "data:image/jpeg;base64,"];

export type CustomBackground = {
  name: string;
  dataUrl: string;
  fit: "cover" | "contain";
  video?: WallpaperVideo | null;
};

export function normalizeWallpaperVideo(value: unknown): WallpaperVideo | null {
  if (typeof value !== "object" || value === null) return null;
  const video = value as Record<string, unknown>;
  if (
    typeof video.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(video.id) ||
    (video.mime !== "video/mp4" && video.mime !== "video/webm")
  )
    return null;
  return { id: video.id, mime: video.mime };
}

export function backgroundMediaIdentity(
  background: Pick<CustomBackground, "dataUrl" | "video"> | null | undefined,
): string | undefined {
  return background?.video
    ? `video:${background.video.id}`
    : background?.dataUrl;
}
export class BackgroundImageError extends Error {
  constructor(readonly code: "type" | "size" | "decode") {
    super("Background image: " + code);
  }
}

/** 只接受有界的栅格 data URL；持久化数据不能指定路径、远端资源或 SVG。 */
export function normalizeBackgroundImage(
  value: unknown,
): CustomBackground | null {
  if (typeof value !== "object" || value === null) return null;
  const image = value as Record<string, unknown>;
  const { name, dataUrl } = image;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    [...name].length > 120 ||
    /\p{Cc}/u.test(name) ||
    typeof dataUrl !== "string" ||
    dataUrl.length > MAX_BACKGROUND_DATA_LENGTH
  )
    return null;
  const prefix = DATA_PREFIXES.find((candidate) =>
    dataUrl.startsWith(candidate),
  );
  if (!prefix) return null;
  const encoded = dataUrl.slice(prefix.length);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    return null;
  try {
    const header = atob(encoded.slice(0, 24));
    if (
      prefix.includes("webp")
        ? header.slice(0, 4) !== "RIFF" || header.slice(8, 12) !== "WEBP"
        : !header.startsWith("\xff\xd8\xff")
    )
      return null;
  } catch {
    return null;
  }
  const video =
    image.video === undefined || image.video === null
      ? undefined
      : normalizeWallpaperVideo(image.video);
  if (video === null) return null;
  return {
    name,
    dataUrl,
    fit: image.fit === "contain" ? "contain" : "cover",
    ...(video ? { video } : {}),
  };
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new BackgroundImageError("decode"));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new BackgroundImageError("decode"));
    reader.readAsDataURL(blob);
  });
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new BackgroundImageError("decode"));
        if (blob.type === "image/webp") return resolve(blob);
        // 不支持 WebP 编码的 WebView 使用同样经过重绘的 JPEG。
        canvas.toBlob(
          (jpeg) =>
            jpeg ? resolve(jpeg) : reject(new BackgroundImageError("decode")),
          "image/jpeg",
          quality,
        );
      },
      "image/webp",
      quality,
    );
  });
}

/** 解码前检查压缩文件中的尺寸，文件缓冲和像素量各自有界。 */
async function inspectImageSize(file: File): Promise<void> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new BackgroundImageError("decode"));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new BackgroundImageError("decode"));
    reader.readAsArrayBuffer(file);
  });
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let width = 0;
  let height = 0;
  if (
    file.type === "image/png" &&
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) &&
    view.getUint32(12) === 0x49484452
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (
    file.type === "image/jpeg" &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        if (length < 8) break;
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    file.type === "image/webp" &&
    bytes.length >= 25 &&
    view.getUint32(0) === 0x52494646 &&
    view.getUint32(8) === 0x57454250
  ) {
    const chunk = view.getUint32(12);
    if (chunk === 0x56503858 && bytes.length >= 30) {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (chunk === 0x5650384c && bytes[20] === 0x2f) {
      const dimensions = view.getUint32(21, true);
      width = 1 + (dimensions & 0x3fff);
      height = 1 + ((dimensions >>> 14) & 0x3fff);
    } else if (
      chunk === 0x56503820 &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    }
  }
  if (width <= 0 || height <= 0) throw new BackgroundImageError("decode");
  if (
    width > MAX_SOURCE_IMAGE_EDGE ||
    height > MAX_SOURCE_IMAGE_EDGE ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw new BackgroundImageError("size");
}

/** 用户选中的图片只在本机解码、缩放与重编码，去除原图元数据并限制偏好体积。 */
export async function importBackgroundImage(
  file: File,
): Promise<CustomBackground> {
  if (!IMAGE_TYPES.includes(file.type)) throw new BackgroundImageError("type");
  if (file.size <= 0 || file.size > MAX_BACKGROUND_FILE_BYTES)
    throw new BackgroundImageError("size");
  await inspectImageSize(file);
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new BackgroundImageError("decode");
  }
  const canvas = document.createElement("canvas");
  try {
    if (
      image.width <= 0 ||
      image.height <= 0 ||
      image.width * image.height > MAX_IMAGE_PIXELS
    )
      throw new BackgroundImageError("size");
    const context = canvas.getContext("2d");
    if (!context) throw new BackgroundImageError("decode");
    const initialScale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(image.width, image.height),
    );
    // 正常照片优先保留清晰度；高噪点图片继续缩小，直到适合图库预算。
    for (
      let edge = MAX_IMAGE_EDGE;
      edge >= 64;
      edge = Math.floor(edge * 0.75)
    ) {
      const reduction = edge / MAX_IMAGE_EDGE;
      canvas.width = Math.max(
        1,
        Math.round(image.width * initialScale * reduction),
      );
      canvas.height = Math.max(
        1,
        Math.round(image.height * initialScale * reduction),
      );
      // 改变画布尺寸会重置绘图状态，必须在每次重采样前恢复高质量平滑。
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.64, 0.46]) {
        const blob = await encode(canvas, quality);
        if (Math.ceil(blob.size / 3) * 4 + 32 > MAX_BACKGROUND_DATA_LENGTH)
          continue;
        const dataUrl = await readDataUrl(blob);
        const name =
          [...file.name.replace(/\p{Cc}/gu, "").trim()]
            .slice(0, 120)
            .join("") || "background";
        const result = normalizeBackgroundImage({
          name,
          dataUrl,
          fit: "cover",
        });
        if (result) return result;
      }
    }
    throw new BackgroundImageError("size");
  } finally {
    image.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

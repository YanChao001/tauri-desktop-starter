export const MAX_BACKGROUND_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKGROUND_DATA_LENGTH = 96 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_EDGE = 1600;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DATA_PREFIXES = ["data:image/webp;base64,", "data:image/jpeg;base64,"];

export type CustomBackground = {
  name: string;
  dataUrl: string;
  fit: "cover" | "contain";
};
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
  return { name, dataUrl, fit: image.fit === "contain" ? "contain" : "cover" };
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

/** 用户选中的图片只在本机解码、缩放与重编码，去除原图元数据并限制偏好体积。 */
export async function importBackgroundImage(
  file: File,
): Promise<CustomBackground> {
  if (!IMAGE_TYPES.includes(file.type)) throw new BackgroundImageError("type");
  if (file.size <= 0 || file.size > MAX_BACKGROUND_FILE_BYTES)
    throw new BackgroundImageError("size");
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
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const initialScale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(image.width, image.height),
    );
    for (const reduction of [1, 0.75, 0.5]) {
      canvas.width = Math.max(
        1,
        Math.round(image.width * initialScale * reduction),
      );
      canvas.height = Math.max(
        1,
        Math.round(image.height * initialScale * reduction),
      );
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

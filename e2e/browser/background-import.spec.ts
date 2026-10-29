/// <reference lib="dom" />
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

function textChunk(bytes: number): Buffer {
  const content = Buffer.concat([
    Buffer.from("Comment\0"),
    Buffer.alloc(bytes, 65),
  ]);
  const kind = Buffer.from("tEXt");
  const table = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let checksum = 0xffffffff;
  for (const byte of Buffer.concat([kind, content]))
    checksum = table[(checksum ^ byte) & 255]! ^ (checksum >>> 8);
  const chunk = Buffer.alloc(content.length + 12);
  chunk.writeUInt32BE(content.length, 0);
  kind.copy(chunk, 4);
  content.copy(chunk, 8);
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

test("a large high-resolution photo is optimized automatically without manual resizing", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("./#/settings");
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 9000;
      canvas.height = 6000;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#386789";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#e4b691";
      context.fillRect(4500, 0, 4500, 6000);
      const encoded = canvas.toDataURL("image/png").split(",")[1]!;
      canvas.width = canvas.height = 0;
      return encoded;
    }),
    "base64",
  );
  // 合法 PNG 文本元数据也计入原图大小，重绘后不会进入偏好存档。
  const image = Buffer.concat([
    png.subarray(0, -12),
    textChunk(12 * 1024 * 1024),
    png.subarray(-12),
  ]);
  expect(image.length).toBeGreaterThan(10 * 1024 * 1024);
  await expect(
    page.getByRole("button", { name: "Add wallpapers", exact: true }),
  ).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: "panorama.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    page.getByRole("radio", {
      name: "Use wallpaper: panorama.png",
      exact: true,
    }),
  ).toBeChecked();
  const background = page.locator("[data-custom-background]");
  await expect
    .poll(() =>
      background.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(1600);
  const source = await background.getAttribute("src");
  expect(source?.length).toBeLessThanOrEqual(96 * 1024);
  await expect(page.locator(".wallpaper-card")).toHaveCount(1);
});

import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

/** Snapshot only declared single-file documents. Rust remains the protocol authority. */
export async function readUiDocuments(manifest, directory) {
  const ids = [
    ...new Set(
      manifest.commands
        .map((command) => command.ui?.document)
        .filter((id) => id !== undefined && id !== null),
    ),
  ];
  if (!ids.length) return {};
  if (
    !directory ||
    ids.length > 32 ||
    ids.some((id) => typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id))
  )
    throw new Error("带自定义界面的扩展需要 --ui-dir，且文档 ID 不能包含路径");
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("UI 源码目录不能是链接");
  let total = 0;
  const entries = [];
  for (const id of ids.sort()) {
    const path = join(directory, `${id}.html`),
      metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > 512 * 1024
    )
      throw new Error("UI 文档需要最多 512 KiB 的普通 HTML 文件");
    const file = await open(path, "r");
    let bytes;
    try {
      const buffer = Buffer.alloc(512 * 1024 + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      bytes = buffer.subarray(0, length);
    } finally {
      await file.close();
    }
    total += bytes.length;
    if (bytes.length > 512 * 1024 || total > 2 * 1024 * 1024)
      throw new Error("UI 文档超过大小限制");
    entries.push([id, new TextDecoder("utf-8", { fatal: true }).decode(bytes)]);
  }
  return Object.fromEntries(entries);
}

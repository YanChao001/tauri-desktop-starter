#!/usr/bin/env node
/** 同步 package.json、tauri.conf.json、Cargo.toml 与 Cargo.lock 中的自身版本。 */
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { prepareVersionUpdates } from "./version.mjs";
import { applyFileChanges } from "./fs-utils.mjs";

const root = join(import.meta.dirname, "..");
const next = process.argv[2];

try {
  if (process.argv.length !== 3) {
    throw new Error(
      "用法: pnpm version:set <x.y.z>，例如 pnpm version:set 1.2.0",
    );
  }
  const updates = prepareVersionUpdates(root, next);
  for (const update of updates) {
    if (!update.path.endsWith(".json")) continue;
    const filepath = join(root, update.path);
    update.content = await format(update.content, {
      ...(await resolveConfig(filepath)),
      filepath,
    });
  }
  applyFileChanges({ root, changes: updates });
  console.log(`版本号已更新: ${updates[0].previous} -> ${next}`);
  for (const { path } of updates) console.log(`  ${path}`);
  console.log(
    `\n下一步：提交后打 tag（git tag -a v${next} -m "v${next}"）并推送。`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

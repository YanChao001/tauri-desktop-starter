import type { ExtensionInfo, MarketEntry } from "@/lib/tauri";

export function compareExtensionVersions(left: string, right: string) {
  const a = left.split(".").map(Number),
    b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
export function marketUpdate(
  entries: readonly MarketEntry[],
  installed: ExtensionInfo,
  hostVersion: string,
) {
  return entries.find(
    (entry) =>
      entry.package.manifest.id === installed.package.manifest.id &&
      compareExtensionVersions(
        hostVersion,
        entry.package.manifest.minHostVersion,
      ) >= 0 &&
      compareExtensionVersions(
        entry.package.manifest.version,
        installed.package.manifest.version,
      ) > 0,
  );
}

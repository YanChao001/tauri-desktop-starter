import type {
  BundledExtension,
  BundledExtensionCatalog,
  ExtensionInfo,
  MarketEntry,
  MarketSnapshot,
} from "@/lib/tauri";

export type ExtensionCatalogEntry =
  (BundledExtension & { kind: "bundled" }) | (MarketEntry & { kind: "market" });

export function extensionCatalogEntries(
  bundled: BundledExtensionCatalog | null,
  market: MarketSnapshot | null,
): ExtensionCatalogEntry[] {
  return [
    ...(bundled?.entries ?? []).map((entry) => ({
      ...entry,
      kind: "bundled" as const,
    })),
    ...(market?.catalog.entries ?? []).map((entry) => ({
      ...entry,
      kind: "market" as const,
    })),
  ].sort(
    (a, b) =>
      Number(b.kind === "bundled") - Number(a.kind === "bundled") ||
      a.package.manifest.name.localeCompare(b.package.manifest.name),
  );
}

export function compareExtensionVersions(left: string, right: string) {
  const a = left.split(".").map(Number),
    b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
export function marketUpdate<T extends Pick<MarketEntry, "package">>(
  entries: readonly T[],
  installed: ExtensionInfo,
  hostVersion: string,
) {
  return entries
    .filter(
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
    )
    .sort((a, b) =>
      compareExtensionVersions(
        b.package.manifest.version,
        a.package.manifest.version,
      ),
    )[0];
}

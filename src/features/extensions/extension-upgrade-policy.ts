import type {
  ExtensionInfo,
  ExtensionOrigin,
  ExtensionPreview,
} from "@/lib/tauri";
import { compareExtensionVersions } from "./market-model";

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const first = new Set(left);
  const second = new Set(right);
  return (
    first.size === second.size && [...first].every((value) => second.has(value))
  );
}

/** 仅决定是否展示重复审阅；安装时仍由原生重新核对来源、权限和 revision。 */
export function canUpdateWithoutReview(
  installed: ExtensionInfo | undefined,
  preview: ExtensionPreview,
  origin: ExtensionOrigin,
): boolean {
  if (!installed || installed.package.manifest.id !== preview.manifest.id)
    return false;
  const previous = installed.package.manifest;
  const next = preview.manifest;
  if (!(compareExtensionVersions(next.version, previous.version) > 0))
    return false;
  const sameOrigin =
    (origin.kind === "bundled" && installed.origin.kind === "bundled") ||
    (origin.kind === "market" &&
      installed.origin.kind === "market" &&
      origin.source.repository === installed.origin.source.repository &&
      origin.source.publicKeyFingerprint ===
        installed.origin.source.publicKeyFingerprint);
  const network = (value: ExtensionPreview["manifest"]) =>
    value.network.map((rule) =>
      JSON.stringify([rule.origin, [...new Set(rule.methods)].sort()]),
    );
  return (
    sameOrigin &&
    sameSet(previous.permissions, next.permissions) &&
    sameSet(previous.optionalPermissions, next.optionalPermissions) &&
    sameSet(network(previous), network(next))
  );
}

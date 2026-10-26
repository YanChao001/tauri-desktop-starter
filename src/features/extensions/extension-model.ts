import type { ExtensionCommand, ExtensionInfo } from "@/lib/tauri";

/** Commands with optional capabilities stay unavailable until those grants exist. */
export function canRunExtensionCommand(
  item: ExtensionInfo,
  command: ExtensionCommand,
) {
  return (
    item.enabled &&
    command.permissions.every((permission) =>
      item.grantedPermissions.includes(permission),
    )
  );
}

export function availableExtensionCommands(item: ExtensionInfo) {
  return item.package.manifest.commands.filter((command) =>
    canRunExtensionCommand(item, command),
  );
}

export function extensionNetworkOrigins(item: ExtensionInfo) {
  return item.package.manifest.network.map((rule) => rule.origin);
}

/** Runtime identity rotates on install/replacement even for identical Wasm bytes. */
export function extensionInstallationIdentity(item: ExtensionInfo): string {
  return `${item.package.manifest.id}:${item.generation}:${item.package.sha256}:${item.package.manifest.version}`;
}

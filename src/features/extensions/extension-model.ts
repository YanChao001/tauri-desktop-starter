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

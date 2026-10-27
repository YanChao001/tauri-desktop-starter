import type {
  ExtensionCommand,
  ExtensionInfo,
  ExtensionView,
} from "@/lib/tauri";

export const EXTENSION_FIELD_BYTES = 64 * 1024;
export function extensionFieldBytes(
  field: ExtensionView["fields"][number],
): number {
  return field.maxBytes ?? EXTENSION_FIELD_BYTES;
}

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

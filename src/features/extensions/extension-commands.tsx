import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AppCommand } from "@/commands/types";
import { useRegisterCommands } from "@/providers/commands";
import { isTauri } from "@/lib/tauri";
import { extensionPath } from "@/routes";
import { canRunExtensionCommand } from "./extension-model";
import { useExtensions } from "./extensions-provider";
import { resolveExtensionIcon } from "./extension-icon";

/** Register enabled commands and navigate to their tool or application view. */
export function ExtensionCommands() {
  const navigate = useNavigate();
  const { data } = useExtensions();
  const commands = useMemo<AppCommand[]>(
    () =>
      (data?.items ?? [])
        .filter((item) => item.enabled)
        .flatMap((item) =>
          item.package.manifest.commands
            .filter((command) => canRunExtensionCommand(item, command))
            .map((command) => ({
              id: `extension:${item.package.manifest.id}:${command.id}`,
              labelKey: "ext.title",
              label: `${item.package.manifest.name}: ${command.title}`,
              description: item.package.manifest.description,
              group: "tools",
              icon: resolveExtensionIcon(item.package.manifest.icon),
              keywords: [item.package.manifest.id, command.title],
              available: isTauri,
              run: () => {
                const query = new URLSearchParams({
                  extension: item.package.manifest.id,
                  command: command.id,
                });
                navigate(
                  command.resultFormat === "view"
                    ? extensionPath(item.package.manifest.id, command.id)
                    : `/extensions?${query}`,
                );
              },
            })),
        ),
    [data, navigate],
  );
  useRegisterCommands(commands);
  return null;
}

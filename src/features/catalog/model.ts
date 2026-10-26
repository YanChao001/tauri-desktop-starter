import type { DictKey } from "@/providers/i18n";

export type CapabilityKind = "local" | "native" | "external" | "inspect";
type CapabilityDetail = {
  kinds: CapabilityKind[];
  description: DictKey;
  doc: string;
};
const details: Record<string, CapabilityDetail> = {
  "/extensions": {
    kinds: ["native"],
    description: "catalog.extensions",
    doc: "docs/extensions.md",
  },
  "/": {
    kinds: ["local"],
    description: "catalog.overview",
    doc: "docs/architecture.md#页面与演示边界",
  },
  "/components": {
    kinds: ["local"],
    description: "catalog.components",
    doc: "docs/conventions/ui-guidelines.md",
  },
  "/motion": {
    kinds: ["local"],
    description: "catalog.motion",
    doc: "docs/conventions/ui-guidelines.md#动效",
  },
  "/bridge": {
    kinds: ["native"],
    description: "catalog.bridge",
    doc: "docs/architecture.md#通信机制",
  },
  "/desktop": {
    kinds: ["native"],
    description: "catalog.desktop",
    doc: "docs/architecture.md#命令与桌面交互",
  },
  "/database": {
    kinds: ["native"],
    description: "catalog.database",
    doc: "docs/architecture.md#数据存储",
  },
  "/diagnostics": {
    kinds: ["native"],
    description: "catalog.diagnostics",
    doc: "docs/troubleshooting.md",
  },
  "/recovery": {
    kinds: ["native"],
    description: "catalog.recovery",
    doc: "docs/architecture.md#恢复诊断与更新",
  },
  "/updates": {
    kinds: ["native", "external"],
    description: "catalog.updates",
    doc: "docs/build-release.md#自动更新",
  },
  "/settings": {
    kinds: ["local", "native"],
    description: "catalog.settings",
    doc: "docs/architecture.md#状态管理与设置迁移",
  },
  "/workbench": {
    kinds: ["native"],
    description: "catalog.workbench",
    doc: "docs/architecture.md",
  },
  "/tasks": {
    kinds: ["native"],
    description: "catalog.tasks",
    doc: "docs/architecture.md",
  },
  "/system": {
    kinds: ["native"],
    description: "catalog.system",
    doc: "docs/security.md",
  },
  "/network": {
    kinds: ["local", "native", "external"],
    description: "catalog.network",
    doc: "docs/security.md",
  },
  "/data-studio": {
    kinds: ["local"],
    description: "catalog.dataStudio",
    doc: "docs/testing.md",
  },
  "/media": {
    kinds: ["local", "native", "external"],
    description: "catalog.media",
    doc: "docs/security.md",
  },
  "/catalog": {
    kinds: ["local"],
    description: "catalog.catalog",
    doc: "docs/development.md",
  },
};

export function capabilityFor(path: string): CapabilityDetail {
  if (path.startsWith("/extensions/app/")) path = "/extensions";
  return (
    details[path] ?? {
      kinds: ["inspect"],
      description: "catalog.generic",
      doc: "docs/architecture.md",
    }
  );
}

export function repositoryFileUrl(repository: string, file: string) {
  return `${repository.replace(/\/$/, "").replace(/\.git$/, "")}/blob/develop/${file}`;
}

export function pageSource(path: string) {
  if (path.startsWith("/extensions/app/")) return "src/pages/extension-app.tsx";
  return `src/pages/${path === "/" ? "overview" : path.slice(1)}.tsx`;
}

export const rustIpcExample = `// src-tauri/src/commands.rs — example to implement
#[tauri::command]
#[specta::specta]
pub fn lab_echo(input: String) -> NativeResult<String> {
    if input.trim().is_empty() || input.len() > 1000 {
        return Err(NativeError::new(ErrorCode::InvalidArgument, "Invalid input"));
    }
    Ok(input)
}

// Register commands::lab_echo in bindings.rs collect_commands!, then:
// pnpm bindings:generate`;

export const typescriptIpcExample = `// src/lib/tauri.ts — named facade
export function labEcho(input: string): Promise<string> {
  return callNative((commands) => commands.labEcho(input));
}

// Page imports labEcho from @/lib/tauri; no direct invoke.
const result = await labEcho(input);`;

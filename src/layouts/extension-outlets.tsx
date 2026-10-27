import { Suspense, useState, type ReactNode } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { PageLoading } from "@/components/page-loading";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { ExtensionActivityProvider } from "@/features/extensions/extension-activity";
import {
  canRunExtensionCommand,
  extensionInstallationIdentity,
} from "@/features/extensions/extension-model";
import type { ExtensionInfo } from "@/lib/tauri";
import { extensionPath } from "@/routes";

type CachedOutlet = {
  path: string;
  identity: string;
  outlet: ReactNode;
  used: number;
};
const MAX_EXTENSION_OUTLETS = 3;

/** 只保留访问过的少量扩展文档；会话草稿仍由独立的会话缓存负责。 */
export function ExtensionOutlets({
  items,
}: {
  items: readonly ExtensionInfo[];
}) {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const valid = new Map(
    items.flatMap((item) =>
      item.package.manifest.commands
        .filter(
          (command) =>
            command.resultFormat === "view" &&
            canRunExtensionCommand(item, command),
        )
        .map((command) => [
          extensionPath(item.package.manifest.id, command.id),
          extensionInstallationIdentity(item),
        ]),
    ),
  );
  const [cache, setCache] = useState<{
    path: string;
    clock: number;
    entries: CachedOutlet[];
  }>({ path: pathname, clock: 0, entries: [] });
  let clock = cache.clock;
  let entries = cache.entries.filter(
    (entry) => valid.get(entry.path) === entry.identity,
  );
  const identity = valid.get(pathname);
  if (identity) {
    const current = entries.find((entry) => entry.path === pathname);
    if (!current || cache.path !== pathname) {
      const used = ++clock;
      // 保持文档的 DOM 顺序：移动含 iframe 的节点会重建其浏览上下文。
      entries = current
        ? entries.map((entry) =>
            entry === current ? { ...entry, used } : entry,
          )
        : [...entries, { path: pathname, identity, outlet, used }];
      if (entries.length > MAX_EXTENSION_OUTLETS) {
        const oldest = entries.reduce((previous, entry) =>
          entry.used < previous.used ? entry : previous,
        );
        entries = entries.filter((entry) => entry !== oldest);
      }
    }
  }
  if (
    cache.path !== pathname ||
    entries.length !== cache.entries.length ||
    entries.some((entry, index) => entry !== cache.entries[index])
  )
    setCache({ path: pathname, clock, entries });

  return (
    <>
      {entries.map((entry) => {
        const active = entry.path === pathname;
        return (
          <ExtensionActivityProvider
            key={`${entry.path}:${entry.identity}`}
            active={active}
          >
            <div hidden={!active} inert={!active} aria-hidden={!active}>
              <Suspense fallback={<PageLoading />}>
                <RouteErrorBoundary resetKey={entry.identity}>
                  {entry.outlet}
                </RouteErrorBoundary>
              </Suspense>
            </div>
          </ExtensionActivityProvider>
        );
      })}
      {!identity ? (
        <Suspense key={pathname} fallback={<PageLoading />}>
          <RouteErrorBoundary>{outlet}</RouteErrorBoundary>
        </Suspense>
      ) : null}
    </>
  );
}

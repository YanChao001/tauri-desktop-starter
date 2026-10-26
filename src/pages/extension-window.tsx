import type { CSSProperties } from "react";
import { TitleBar } from "@/components/title-bar";
import { WindowBackground } from "@/components/window-background";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { useAppChrome } from "@/hooks/use-app-chrome";
import { useCommands } from "@/providers/commands";
import { ExtensionPage } from "./extension-app";
import { useLocation, useParams } from "react-router-dom";
import { useExtensions } from "@/features/extensions/extensions-provider";
import { ExtensionChromeProvider } from "@/features/extensions/extension-chrome-slot";

/** 独立会话复用宿主皮肤与窗口按钮，内容在标题栏下独立滚动。 */
export default function ExtensionWindow() {
  const chrome = useAppChrome();
  const { execute } = useCommands();
  const { pathname } = useLocation();
  const { extensionId } = useParams();
  const { data } = useExtensions();
  const item = data?.items.find(
    (item) => item.package.manifest.id === extensionId,
  );
  return (
    <ExtensionChromeProvider scope={pathname}>
      <div
        className="app-shell text-foreground"
        style={{ "--app-sidebar-width": "0px" } as CSSProperties}
      >
        <WindowBackground />
        <div ref={chrome} className="app-chrome">
          <TitleBar standalone extension={item?.package.manifest} />
        </div>
        <main className="app-main app-scroll-region" tabIndex={-1}>
          <div className="mx-auto max-w-6xl p-4 sm:p-6">
            <RouteErrorBoundary
              onBack={() => void execute("close-window")}
              backLabel="common.close"
            >
              <ExtensionPage standalone />
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
    </ExtensionChromeProvider>
  );
}

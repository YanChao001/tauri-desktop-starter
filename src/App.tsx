import { ThemeProvider } from "next-themes";
import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExternalLinks, useRevealWindow } from "@/lib/tauri";
import Bridge from "@/pages/bridge";
import Overview from "@/pages/overview";
import Settings from "@/pages/settings";

export default function App() {
  useExternalLinks();
  useRevealWindow();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={200}>
        {/* HashRouter：生产构建下用的是自定义协议，hash 路由不会出现刷新 404 */}
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Overview />} />
              <Route path="bridge" element={<Bridge />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </HashRouter>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}

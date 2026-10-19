import { ThemeProvider } from "next-themes";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExternalLinks } from "@/hooks/use-external-links";
import { useRevealWindow } from "@/hooks/use-reveal-window";
import { AppShell } from "@/layouts/app-shell";
import { I18nProvider } from "@/providers/i18n";
import { SettingsProvider } from "@/providers/settings";
import { CommandsProvider } from "@/providers/commands";
import { CommandPalette } from "@/components/command-palette";
import { DesktopEffects } from "@/components/desktop-effects";
import { APP_ROUTES } from "@/routes";

function AppEffects() {
  useExternalLinks();
  useRevealWindow();
  return null;
}

export default function App() {
  return (
    <SettingsProvider>
      <I18nProvider>
        <AppEffects />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200}>
            {/* HashRouter：生产构建下用的是自定义协议，hash 路由不会出现刷新 404 */}
            <HashRouter>
              <CommandsProvider>
                <DesktopEffects />
                <Routes>
                  <Route element={<AppShell />}>
                    {APP_ROUTES.map(({ path, component: Page, index }) => (
                      <Route
                        key={path}
                        index={index}
                        path={index ? undefined : path}
                        element={<Page />}
                      />
                    ))}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
                <CommandPalette />
              </CommandsProvider>
            </HashRouter>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </SettingsProvider>
  );
}

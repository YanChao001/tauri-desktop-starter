import { ThemeProvider } from "next-themes";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExternalLinks } from "@/hooks/use-external-links";
import { useRevealWindow } from "@/hooks/use-reveal-window";
import { AppShell } from "@/layouts/app-shell";
import { I18nProvider } from "@/providers/i18n";
import { SettingsProvider } from "@/providers/settings";
import { APP_ROUTES } from "@/routes";

export default function App() {
  useExternalLinks();
  useRevealWindow();

  return (
    <SettingsProvider>
      <I18nProvider>
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
                  {APP_ROUTES.map(({ path, component: Page, index }) => (
                    <Route
                      key={path}
                      index={index}
                      path={index ? undefined : path}
                      element={<Page />}
                    />
                  ))}
                </Route>
              </Routes>
            </HashRouter>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </SettingsProvider>
  );
}

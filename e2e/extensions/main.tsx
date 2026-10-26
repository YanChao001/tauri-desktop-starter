import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FixtureTheme } from "./providers";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { ExtensionsProvider } from "../../src/features/extensions/extensions-provider";
import { AppShell } from "../../src/layouts/app-shell";
import ExtensionPage from "../../src/pages/extension-app";
import ExtensionWindow from "../../src/pages/extension-window";
import Extensions from "../../src/pages/extensions";
import "./fixture.css";

const params = new URLSearchParams(location.search),
  plugin = params.get("plugin") ?? "scientific-calculator";
const id = plugin === "lab" ? "starter.extension-lab" : `market.${plugin}`;
const command =
  plugin === "lab"
    ? "open"
    : plugin === "scientific-calculator"
      ? "workspace"
      : plugin === "lan-chat"
        ? "chat"
        : plugin === "wallpaper-browser"
          ? "browse"
          : "play";
const standalone = params.get("window") === "true";
const initial =
  plugin === "center"
    ? "/extensions"
    : `/${standalone ? "extension-window" : "extensions/app"}/${id}/${command}`;
document.documentElement.lang =
  params.get("language") === "en" ? "en" : "zh-CN";
document.documentElement.style.fontSize = params.get("font") ?? "16px";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FixtureTheme>
      <TooltipProvider>
        <ExtensionsProvider>
          <MemoryRouter initialEntries={[initial]}>
            <Routes>
              <Route
                path="/extension-window/:extensionId/:commandId"
                element={<ExtensionWindow />}
              />
              <Route element={<AppShell />}>
                <Route path="/extensions" element={<Extensions />} />
                <Route
                  path="/extensions/app/:extensionId/:commandId"
                  element={<ExtensionPage />}
                />
                <Route path="/settings" element={<p>Fixture settings</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ExtensionsProvider>
      </TooltipProvider>
    </FixtureTheme>
  </StrictMode>,
);

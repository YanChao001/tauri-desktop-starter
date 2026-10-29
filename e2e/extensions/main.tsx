import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FixtureTheme } from "./providers";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { Toaster } from "../../src/components/ui/sonner";
import { ExtensionsProvider } from "../../src/features/extensions/extensions-provider";
import { AppShell } from "../../src/layouts/app-shell";
import ExtensionPage from "../../src/pages/extension-app";
import ExtensionWindow from "../../src/pages/extension-window";
import Extensions from "../../src/pages/extensions";
import { CustomBackgroundPicker } from "../../src/components/custom-background-picker";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Textarea } from "../../src/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
} from "../../src/components/ui/select";
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

function HostStyleReferences() {
  return (
    <aside
      aria-hidden="true"
      inert
      style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}
    >
      {(
        ["default", "outline", "secondary", "ghost", "destructive"] as const
      ).flatMap((variant) =>
        (["default", "sm", "icon", "icon-sm", "icon-xs"] as const).map(
          (size) => (
            <Button
              key={`${variant}:${size}`}
              data-host-style-reference={`button:${variant}:${size}`}
              variant={variant}
              size={size}
            >
              Reference
            </Button>
          ),
        ),
      )}
      <Input data-host-style-reference="input" />
      <Textarea data-host-style-reference="textarea" />
      <Select defaultValue="reference">
        <SelectTrigger data-host-style-reference="select">
          <SelectValue placeholder="Reference" />
        </SelectTrigger>
      </Select>
    </aside>
  );
}
document.documentElement.lang =
  params.get("language") === "en" ? "en" : "zh-CN";
document.documentElement.style.fontSize = params.get("font") ?? "16px";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FixtureTheme>
      <TooltipProvider>
        <HostStyleReferences />
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
        {params.get("wallpaperSurfaceProbe") === "true" ? (
          <aside data-wallpaper-settings-probe hidden>
            <CustomBackgroundPicker />
          </aside>
        ) : null}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </FixtureTheme>
  </StrictMode>,
);

import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SunIcon,
  ChevronDownIcon,
} from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitch } from "@/components/language-switch";
import { SkinPicker } from "@/components/skin-picker";
import { SettingsSearch } from "@/components/settings-search";
import { SettingsPersistence } from "@/components/settings-persistence";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useI18n } from "@/providers/i18n";
import {
  ACCENTS,
  useSettings,
  type Accent,
  type Font,
  type FontSize,
  type Radius,
} from "@/providers/settings";
import { getAppInfo, isTauri, openExternal } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", labelKey: "title.light", icon: SunIcon },
  { value: "dark", labelKey: "title.dark", icon: MoonIcon },
  { value: "system", labelKey: "title.system", icon: MonitorIcon },
] as const;

const ACCENT_COLORS: Record<Accent, string> = {
  neutral: "oklch(0.205 0 0)",
  indigo: "oklch(0.51 0.23 277)",
  blue: "oklch(0.55 0.19 250)",
  emerald: "oklch(0.55 0.14 160)",
  amber: "oklch(0.76 0.16 80)",
  rose: "oklch(0.56 0.22 12)",
  violet: "oklch(0.53 0.24 300)",
};

const FONT_OPTIONS = [
  { value: "geist", labelKey: "settings.fontGeist" },
  { value: "system", labelKey: "settings.fontSystem" },
  { value: "serif", labelKey: "settings.fontSerif" },
  { value: "mono", labelKey: "settings.fontMono" },
] as const;

const LINKS = [
  { label: "Tauri", url: "https://v2.tauri.app/" },
  { label: "shadcn/ui", url: "https://ui.shadcn.com/" },
  { label: "Tailwind CSS", url: "https://tailwindcss.com/" },
];

function SettingRow({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="flex items-center justify-between gap-6 rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const translateLatest = useLatestTranslator();
  const { theme, setTheme } = useThemeSwitch();
  const { settings, update, reset } = useSettings();
  const [version, setVersion] = useState("—");
  const [tauriVersion, setTauriVersion] = useState("—");

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await getAppInfo();
        if (cancelled) return;
        setVersion(info.version);
        setTauriVersion(info.tauriVersion);
      } catch (error) {
        console.error("读取版本信息失败", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOpenLink(url: string) {
    try {
      await openExternal(url);
    } catch (error) {
      console.error("打开外链失败", error);
      toast.error(translateLatest("common.openFailed"));
    }
  }

  return (
    <div className="studio-page settings-studio">
      <div className="studio-intro">
        <span className="studio-eyebrow">{t("studio.settingsEyebrow")}</span>
        <h2>{t("settings.title")}</h2>
        <p>{t("settings.subtitle")}</p>
      </div>

      <SettingsSearch />
      <SettingsPersistence />
      <section
        id="settings-skin"
        tabIndex={-1}
        className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SkinPicker />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("settings.appearance")}</CardTitle>
          <CardDescription className="text-xs">
            {t("settings.appearanceHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow id="settings-language" label={t("common.language")}>
            <LanguageSwitch />
          </SettingRow>
          <div
            id="settings-theme"
            tabIndex={-1}
            className="space-y-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Label className="text-xs">{t("settings.theme")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((item) => {
                const active = theme === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(item.value)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border px-3 py-3 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/5 font-medium"
                        : "text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    <item.icon className="size-4" />
                    {t(item.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            id="settings-accent"
            tabIndex={-1}
            className="space-y-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t("settings.accent")}</Label>
              <span className="text-[11px] text-muted-foreground">
                {t("settings.accentHint")}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((accent) => {
                const active = settings.accent === accent;
                return (
                  <button
                    key={accent}
                    type="button"
                    aria-label={t(`settings.color.${accent}`)}
                    title={t(`settings.color.${accent}`)}
                    aria-pressed={active}
                    onClick={() => update({ accent })}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full border transition-transform hover:scale-110",
                      active &&
                        "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                    style={{ backgroundColor: ACCENT_COLORS[accent] }}
                  >
                    {active ? (
                      <CheckIcon className="size-3.5 text-white mix-blend-difference" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          <SettingRow id="settings-radius" label={t("settings.radius")}>
            <ToggleGroup
              type="single"
              aria-label={t("settings.radius")}
              size="sm"
              value={settings.radius}
              onValueChange={(value) => {
                if (value) update({ radius: value as Radius });
              }}
            >
              <ToggleGroupItem value="sharp" className="text-xs">
                {t("settings.radiusSharp")}
              </ToggleGroupItem>
              <ToggleGroupItem value="soft" className="text-xs">
                {t("settings.radiusSoft")}
              </ToggleGroupItem>
              <ToggleGroupItem value="round" className="text-xs">
                {t("settings.radiusRound")}
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>

          <SettingRow id="settings-font" label={t("settings.font")}>
            <Select
              value={settings.font}
              onValueChange={(value) => update({ font: value as Font })}
            >
              <SelectTrigger
                className="w-40"
                size="sm"
                aria-label={t("settings.font")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow id="settings-fontSize" label={t("settings.fontSize")}>
            <ToggleGroup
              type="single"
              aria-label={t("settings.fontSize")}
              size="sm"
              value={settings.fontSize}
              onValueChange={(value) => {
                if (value) update({ fontSize: value as FontSize });
              }}
            >
              <ToggleGroupItem value="sm" className="text-xs">
                {t("settings.fontSizeSm")}
              </ToggleGroupItem>
              <ToggleGroupItem value="md" className="text-xs">
                {t("settings.fontSizeMd")}
              </ToggleGroupItem>
              <ToggleGroupItem value="lg" className="text-xs">
                {t("settings.fontSizeLg")}
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>

          <SettingRow
            id="settings-motion"
            label={t("settings.motion")}
            hint={t("settings.motionHint")}
          >
            <ToggleGroup
              type="single"
              aria-label={t("settings.motion")}
              size="sm"
              value={settings.motion}
              onValueChange={(value) => {
                if (value) update({ motion: value as "full" | "reduced" });
              }}
            >
              <ToggleGroupItem value="full" className="text-xs">
                {t("settings.motionFull")}
              </ToggleGroupItem>
              <ToggleGroupItem value="reduced" className="text-xs">
                {t("settings.motionReduced")}
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
        </CardContent>
      </Card>

      <Card id="settings-layout" tabIndex={-1}>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("studio.settingsWorkspace")}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            id="settings-menuBar"
            label={t("settings.menuBar")}
            hint={t("settings.menuBarHint")}
          >
            <Switch
              checked={settings.menuBar}
              onCheckedChange={(checked) => update({ menuBar: checked })}
              aria-label={t("settings.menuBar")}
            />
          </SettingRow>
          <SettingRow
            id="settings-appMode"
            label={t("settings.appMode")}
            hint={t("settings.appModeDescription")}
          >
            <ToggleGroup
              type="single"
              aria-label={t("settings.appMode")}
              value={settings.appMode}
              onValueChange={(value) => {
                if (value === "demo" || value === "minimal")
                  update({ appMode: value });
              }}
            >
              <ToggleGroupItem value="demo">
                {t("settings.modeDemo")}
              </ToggleGroupItem>
              <ToggleGroupItem value="minimal">
                {t("settings.modeMinimal")}
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
          <SettingRow label={t("settings.sidebarCollapsed")}>
            <Switch
              aria-label={t("settings.sidebarCollapsed")}
              checked={settings.sidebarCollapsed}
              onCheckedChange={(value) => update({ sidebarCollapsed: value })}
            />
          </SettingRow>
          <SettingRow label={t("settings.sidebarWidth")}>
            <input
              type="range"
              min={180}
              max={360}
              step={4}
              value={settings.sidebarWidth}
              onChange={(event) =>
                update({ sidebarWidth: Number(event.target.value) })
              }
              aria-label={t("settings.sidebarWidth")}
              className="w-40 accent-primary"
            />
          </SettingRow>
        </CardContent>
      </Card>

      <details className="studio-panel settings-about" id="settings-about">
        <summary>
          {t("studio.settingsAbout")}
          <ChevronDownIcon size={16} />
        </summary>
        <div className="settings-about-content">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.runtime")}</CardTitle>
              <CardDescription className="text-xs">
                {t("settings.runtimeHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              <SettingRow label={t("settings.appVersion")}>
                <span className="font-mono text-xs">{version}</span>
              </SettingRow>
              <SettingRow label={t("settings.tauriVersion")}>
                <span className="font-mono text-xs">{tauriVersion}</span>
              </SettingRow>
              <SettingRow label={t("settings.environment")}>
                <Badge variant="outline" className="font-normal">
                  {isTauri() ? t("app.native") : t("app.preview")}
                </Badge>
              </SettingRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.links")}</CardTitle>
              <CardDescription className="text-xs">
                {t("settings.linksHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {LINKS.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  onClick={() => void handleOpenLink(link.url)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                >
                  <span>{link.label}</span>
                  <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    {new URL(link.url).host}
                    <ExternalLinkIcon className="size-3" />
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </details>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed px-4 py-3">
        <div className="space-y-0.5">
          <p className="text-sm">{t("common.reset")}</p>
          <p className="text-xs text-muted-foreground">
            {t("settings.resetHint")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            reset();
            setTheme("system");
            toast.success(t("common.resetDone"));
          }}
        >
          <RotateCcwIcon />
          {t("common.reset")}
        </Button>
      </div>
    </div>
  );
}

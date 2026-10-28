import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SunIcon,
  ChevronDownIcon,
  LanguagesIcon,
  SunMoonIcon,
  PaletteIcon,
  SquareIcon,
  TypeIcon,
  ALargeSmallIcon,
  ActivityIcon,
  MenuIcon,
  LayersIcon,
  PanelLeftCloseIcon,
  MoveHorizontalIcon,
  LocateIcon,
  GlobeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { LanguageSwitch } from "@/components/language-switch";
import { SkinPicker } from "@/components/skin-picker";
import { SettingsSearch } from "@/components/settings-search";
import { SettingsPersistence } from "@/components/settings-persistence";
import { DesktopSettings } from "@/components/desktop-settings";
import { UpdateSettings } from "@/components/update-settings";
import { SettingLabel, SettingRow } from "@/components/setting-row";
import { HelpTooltip } from "@/components/help-tooltip";
import { ExternalLink } from "@/components/external-link";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  getAppInfo,
  getWindowGeometry,
  isTauri,
  onWindowMoved,
  onWindowResized,
  resetWindowGeometry,
  setWindowSize,
  type WindowGeometry,
} from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
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
  emerald: "oklch(0.51 0.12 164)",
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

export default function Settings() {
  const { t } = useI18n();
  const translateLatest = useLatestTranslator();
  const { theme, setTheme } = useThemeSwitch();
  const { settings, update, reset } = useSettings();
  const [version, setVersion] = useState("—");
  const [tauriVersion, setTauriVersion] = useState("—");
  const [confirmReset, setConfirmReset] = useState(false);
  const [windowGeometry, setGeometry] = useState<WindowGeometry | null>(null);
  const [windowError, setWindowError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const geometryGeneration = useRef(0);
  const native = isTauri();
  const invalidateGeometry = useCallback(() => {
    geometryGeneration.current++;
  }, []);

  const refreshWindow = useCallback(async () => {
    if (running.current) return;
    const generation = ++geometryGeneration.current;
    try {
      const geometry = await getWindowGeometry();
      if (!mounted.current || geometryGeneration.current !== generation) return;
      setGeometry(geometry);
      setWindowError(null);
    } catch (error) {
      if (mounted.current && geometryGeneration.current === generation)
        setWindowError(error);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    const unlisten: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (native) {
      const changed = () => {
        if (stopped) return;
        invalidateGeometry();
        clearTimeout(timer);
        timer = setTimeout(() => void refreshWindow(), 200);
      };
      void Promise.allSettled([
        onWindowResized(changed),
        onWindowMoved(changed),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "fulfilled") {
            if (stopped) result.value();
            else unlisten.push(result.value);
          } else if (!stopped) {
            setWindowError(result.reason);
          }
        }
        if (!stopped) void refreshWindow();
      });
    }
    return () => {
      mounted.current = false;
      stopped = true;
      invalidateGeometry();
      clearTimeout(timer);
      for (const stop of unlisten) stop();
    };
  }, [native, refreshWindow, invalidateGeometry]);

  function acceptGeometry(geometry: WindowGeometry) {
    geometryGeneration.current++;
    setGeometry(geometry);
    setWindowError(null);
  }

  async function applyWindowSize(width: number, height: number) {
    if (
      !native ||
      running.current ||
      !windowGeometry ||
      width < windowGeometry.minWidth ||
      width > windowGeometry.maxWidth ||
      height < windowGeometry.minHeight ||
      height > windowGeometry.maxHeight
    )
      return;
    running.current = true;
    geometryGeneration.current++;
    setPending(true);
    setWindowError(null);
    try {
      const geometry = await setWindowSize(width, height);
      if (mounted.current) {
        acceptGeometry(geometry);
        toast.success(translateLatest("settings.windowSizeApplied"));
      }
    } catch (error) {
      if (mounted.current)
        toast.error(nativeErrorText(error, translateLatest), {
          action: {
            label: translateLatest("common.refresh"),
            onClick: () => void refreshWindow(),
          },
        });
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function restorePreferences() {
    if (running.current) return;
    running.current = true;
    geometryGeneration.current++;
    setPending(true);
    try {
      const geometry = native ? await resetWindowGeometry(false) : null;
      if (geometry && mounted.current) acceptGeometry(geometry);
      await reset();
      if (mounted.current) {
        setConfirmReset(false);
        toast.success(translateLatest("common.resetDone"));
      }
    } catch (error) {
      if (mounted.current) toast.error(nativeErrorText(error, translateLatest));
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const standardWidth = windowGeometry
    ? Math.max(
        windowGeometry.minWidth,
        Math.min(windowGeometry.maxWidth, windowGeometry.defaultWidth),
      )
    : null;
  const standardHeight = windowGeometry
    ? Math.max(
        windowGeometry.minHeight,
        Math.min(windowGeometry.maxHeight, windowGeometry.defaultHeight),
      )
    : null;
  const fittedDefault =
    windowGeometry !== null &&
    (standardWidth !== windowGeometry.defaultWidth ||
      standardHeight !== windowGeometry.defaultHeight);
  const windowPresets = [
    { id: "compact", label: "settings.windowCompact", width: 960, height: 640 },
    {
      id: "standard",
      label: "settings.windowStandard",
      width: standardWidth,
      height: standardHeight,
    },
    {
      id: "comfortable",
      label: "settings.windowComfortable",
      width: 1280,
      height: 800,
    },
    {
      id: "spacious",
      label: "settings.windowSpacious",
      width: 1440,
      height: 900,
    },
  ] as const;
  // 品牌默认尺寸与固定预设相同时，只保留标准选项。
  const visiblePresets = windowPresets.filter(
    (preset) =>
      preset.id === "standard" ||
      preset.width !== standardWidth ||
      preset.height !== standardHeight,
  );

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

  return (
    <div className="studio-page settings-studio">
      <div className="studio-intro">
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
        </CardHeader>
        <CardContent className="space-y-4 [&>.settings-row]:py-0">
          <SettingRow
            id="settings-language"
            icon={LanguagesIcon}
            label={t("common.language")}
          >
            <LanguageSwitch />
          </SettingRow>
          <div
            id="settings-theme"
            tabIndex={-1}
            className="space-y-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SettingLabel icon={SunMoonIcon} label={t("settings.theme")} />
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
            <SettingLabel icon={PaletteIcon} label={t("settings.accent")} />
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

          <SettingRow
            id="settings-radius"
            icon={SquareIcon}
            label={t("settings.radius")}
          >
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

          <SettingRow
            id="settings-font"
            icon={TypeIcon}
            label={t("settings.font")}
          >
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

          <SettingRow
            id="settings-fontSize"
            icon={ALargeSmallIcon}
            label={t("settings.fontSize")}
          >
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
            icon={ActivityIcon}
            label={t("settings.motion")}
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
            icon={MenuIcon}
            label={t("settings.menuBar")}
          >
            <Switch
              checked={settings.menuBar}
              onCheckedChange={(checked) => update({ menuBar: checked })}
              aria-label={t("settings.menuBar")}
            />
          </SettingRow>
          <SettingRow
            id="settings-appMode"
            icon={LayersIcon}
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
          <SettingRow
            icon={PanelLeftCloseIcon}
            label={t("settings.sidebarCollapsed")}
          >
            <Switch
              aria-label={t("settings.sidebarCollapsed")}
              checked={settings.sidebarCollapsed}
              onCheckedChange={(value) => update({ sidebarCollapsed: value })}
            />
          </SettingRow>
          <SettingRow
            icon={MoveHorizontalIcon}
            label={t("settings.sidebarWidth")}
          >
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

      <Card id="settings-window" tabIndex={-1}>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("desktop.settingsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 [&>.settings-row]:py-0">
          <DesktopSettings />
          <Separator />
          <div
            role="group"
            aria-label={t("settings.windowSize")}
            className="window-preset-grid grid grid-cols-2 gap-2"
          >
            {visiblePresets.map((preset) => {
              const unavailable =
                windowGeometry !== null &&
                preset.width !== null &&
                preset.height !== null &&
                (preset.width < windowGeometry.minWidth ||
                  preset.width > windowGeometry.maxWidth ||
                  preset.height < windowGeometry.minHeight ||
                  preset.height > windowGeometry.maxHeight);
              const active =
                windowGeometry !== null &&
                preset.width === windowGeometry.width &&
                preset.height === windowGeometry.height;
              const reasonId = `window-${preset.id}-unavailable`;
              const control = (
                <button
                  key={preset.id}
                  data-window-preset={preset.id}
                  type="button"
                  aria-pressed={active}
                  aria-describedby={unavailable ? reasonId : undefined}
                  disabled={
                    !native || pending || !windowGeometry || unavailable
                  }
                  onClick={() => {
                    if (preset.width !== null && preset.height !== null)
                      void applyWindowSize(preset.width, preset.height);
                  }}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    active
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                    unavailable && "pointer-events-none h-full w-full",
                  )}
                >
                  <span className="text-sm">{t(preset.label)}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {preset.width !== null && preset.height !== null
                      ? `${preset.width} × ${preset.height}`
                      : t("settings.windowDefaultSize")}
                  </span>{" "}
                  {preset.id === "standard" && fittedDefault ? (
                    <span className="sr-only">
                      {t("settings.windowSizeFitted")}
                    </span>
                  ) : null}
                  {unavailable ? (
                    <span id={reasonId} className="sr-only">
                      {t("settings.windowPresetUnavailable")}
                    </span>
                  ) : null}
                </button>
              );
              return unavailable ? (
                <TooltipProvider
                  key={preset.id}
                  delayDuration={650}
                  skipDelayDuration={0}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="group"
                        aria-label={t(preset.label)}
                        aria-describedby={reasonId}
                        tabIndex={0}
                        className="block min-w-0 cursor-not-allowed rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {control}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t("settings.windowPresetUnavailable")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                control
              );
            })}
          </div>
          {native ? (
            <div className="flex min-h-8 min-w-0 items-center justify-between gap-2 text-xs">
              {windowError ? (
                <>
                  <span
                    role="alert"
                    className="min-w-0 break-words text-destructive"
                  >
                    {nativeErrorText(windowError, t)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => void refreshWindow()}
                  >
                    {t("common.retry")}
                  </Button>
                </>
              ) : (
                <span
                  className="truncate text-muted-foreground"
                  aria-live="polite"
                >
                  {windowGeometry
                    ? t("settings.windowCurrentSize", {
                        width: windowGeometry.width,
                        height: windowGeometry.height,
                      })
                    : t("common.loading")}
                </span>
              )}
            </div>
          ) : null}
          <Separator />
          <SettingRow
            id="settings-windowPosition"
            icon={LocateIcon}
            label={t("settings.windowPosition")}
            hint={t("settings.windowPositionHint")}
          >
            <ToggleGroup
              type="single"
              aria-label={t("settings.windowPosition")}
              disabled={pending}
              value={settings.windowPosition}
              onValueChange={(value) => {
                if (value === "remember" || value === "center")
                  update({ windowPosition: value });
              }}
            >
              <ToggleGroupItem value="remember" data-window-position="remember">
                {t("settings.windowPositionRemember")}
              </ToggleGroupItem>
              <ToggleGroupItem value="center" data-window-position="center">
                {t("settings.windowPositionCenter")}
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
        </CardContent>
      </Card>

      <UpdateSettings />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("settings.network")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingRow
            id="settings-networkMode"
            icon={GlobeIcon}
            label={t("settings.networkMode")}
            hint={t(
              native
                ? "settings.networkModeHint"
                : "settings.networkModeBrowserHint",
            )}
          >
            <Select
              value={settings.networkMode}
              disabled={!native}
              onValueChange={(value) => {
                if (value === "system" || value === "direct")
                  update({ networkMode: value });
              }}
            >
              <SelectTrigger
                className="w-44"
                size="sm"
                aria-label={t("settings.networkMode")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">
                  {t("settings.networkModeSystem")}
                </SelectItem>
                <SelectItem value="direct">
                  {t("settings.networkModeDirect")}
                </SelectItem>
              </SelectContent>
            </Select>
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
            </CardHeader>
            <CardContent className="space-y-1">
              {LINKS.map((link) => (
                <ExternalLink
                  key={link.url}
                  href={link.url}
                  className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>{link.label}</span>{" "}
                  <span className="flex min-w-0 items-center gap-1.5 break-all font-mono text-xs text-muted-foreground">
                    {new URL(link.url).host}
                    <ExternalLinkIcon
                      className="size-3 shrink-0"
                      aria-hidden="true"
                    />
                  </span>
                </ExternalLink>
              ))}
            </CardContent>
          </Card>
        </div>
      </details>

      <Card className="flex-row items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="text-sm">{t("common.reset")}</p>
          <HelpTooltip label={t("common.helpFor", { name: t("common.reset") })}>
            {t("settings.resetHint")}
          </HelpTooltip>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setConfirmReset(true);
          }}
        >
          <RotateCcwIcon />
          {t("common.reset")}
        </Button>
      </Card>
      <Dialog
        open={confirmReset}
        onOpenChange={(open) => {
          if (!pending) setConfirmReset(open);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("settings.resetConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.resetConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmReset(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void restorePreferences()}
            >
              {t("common.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

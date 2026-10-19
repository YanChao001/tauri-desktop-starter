import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
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
import { useI18n } from "@/providers/i18n";
import {
  ACCENTS,
  useSettings,
  type Accent,
  type Background,
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

function BackgroundPreview({ kind }: { kind: Background }) {
  if (kind === "gradient") {
    return (
      <div
        className="h-10 rounded-md border"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 20%, color-mix(in oklch, var(--primary) 40%, transparent), transparent 70%)",
        }}
      />
    );
  }
  if (kind === "grid") {
    return (
      <div
        className="h-10 rounded-md border"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--pattern) 1px, transparent 1px), linear-gradient(to bottom, var(--pattern) 1px, transparent 1px)",
          backgroundSize: "10px 10px",
        }}
      />
    );
  }
  if (kind === "dots") {
    return (
      <div
        className="h-10 rounded-md border"
        style={{
          backgroundImage:
            "radial-gradient(var(--pattern) 1.2px, transparent 1.2px)",
          backgroundSize: "8px 8px",
        }}
      />
    );
  }
  return <div className="h-10 rounded-md border bg-muted/40" />;
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
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
  const { theme, setTheme } = useTheme();
  const { settings, update, reset } = useSettings();
  const [version, setVersion] = useState("—");
  const [tauriVersion, setTauriVersion] = useState("—");

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const info = await getAppInfo();
        setVersion(info.version);
        setTauriVersion(info.tauriVersion);
      } catch (error) {
        console.error("读取版本信息失败", error);
      }
    })();
  }, []);

  async function handleOpenLink(url: string) {
    try {
      await openExternal(url);
    } catch (error) {
      console.error("打开外链失败", error);
      toast.error(t("common.openFailed"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("settings.title")}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("settings.appearance")}</CardTitle>
          <CardDescription className="text-xs">
            {t("settings.appearanceHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">{t("settings.theme")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((item) => {
                const active = theme === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
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

          <div className="space-y-2">
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
                    aria-label={accent}
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

          <SettingRow label={t("settings.radius")}>
            <ToggleGroup
              type="single"
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

          <SettingRow label={t("settings.font")}>
            <Select
              value={settings.font}
              onValueChange={(value) => update({ font: value as Font })}
            >
              <SelectTrigger className="w-40" size="sm">
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

          <SettingRow label={t("settings.fontSize")}>
            <ToggleGroup
              type="single"
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

          <div className="space-y-2">
            <Label className="text-xs">{t("settings.background")}</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["plain", "settings.bgPlain"],
                  ["gradient", "settings.bgGradient"],
                  ["grid", "settings.bgGrid"],
                  ["dots", "settings.bgDots"],
                ] as const
              ).map(([value, labelKey]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => update({ background: value })}
                  className={cn(
                    "space-y-1.5 rounded-lg border p-2 text-left transition-colors",
                    settings.background === value
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/40",
                  )}
                >
                  <BackgroundPreview kind={value} />
                  <span className="block text-[11px]">{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <SettingRow
            label={t("settings.motion")}
            hint={t("settings.motionHint")}
          >
            <ToggleGroup
              type="single"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("settings.window")}</CardTitle>
          <CardDescription className="text-xs">
            {t("settings.customTitlebarHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            label={t("settings.menuBar")}
            hint={t("settings.menuBarHint")}
          >
            <Switch
              checked={settings.menuBar}
              onCheckedChange={(checked) => update({ menuBar: checked })}
              aria-label={t("settings.menuBar")}
            />
          </SettingRow>
          <SettingRow label={t("settings.customTitlebar")}>
            <Badge variant="secondary">{t("settings.enabled")}</Badge>
          </SettingRow>
        </CardContent>
      </Card>

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

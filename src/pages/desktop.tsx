import { useEffect, useRef, useState } from "react";
import { MonitorIcon, PowerIcon, PanelTopIcon } from "lucide-react";
import { toast } from "sonner";
import { NativePage, ResourceError } from "@/components/native-page";
import { SettingsPersistence } from "@/components/settings-persistence";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useNativeResource } from "@/hooks/use-native-resource";
import {
  getDesktopStatus,
  getAutostartEnabled,
  setAutostartEnabled,
  openSecondaryWindow,
} from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
async function loadDesktop() {
  const status = await getDesktopStatus();
  const autostart = status.autostartSupported
    ? await getAutostartEnabled()
    : false;
  return { ...status, autostart };
}
export default function Desktop() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const { settings, update } = useSettings();
  const { data, error, loading, reload } = useNativeResource(loadDesktop);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function changeAutostart(enabled: boolean) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await setAutostartEnabled(enabled);
      if (mounted.current) {
        await reload();
        if (mounted.current) toast.success(latest("desktop.changed"));
      }
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function openWindow() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await openSecondaryWindow();
      if (mounted.current) {
        await reload();
        if (mounted.current) toast.success(latest("desktop.windowOpen"));
      }
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <NativePage
      title={t("desktop.title")}
      description={t("desktop.description")}
    >
      <ResourceError error={error} retry={() => void reload()} />
      <SettingsPersistence />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <PowerIcon className="size-4" />
            {t("desktop.autostart")}
          </CardTitle>
          <CardDescription>{t("desktop.autostartDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Switch
            checked={data?.autostart ?? false}
            disabled={loading || pending || !data?.autostartSupported}
            onCheckedChange={(value) => void changeAutostart(value)}
            aria-label={t("desktop.autostart")}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <PanelTopIcon className="size-4" />
            {t("desktop.tray")}
          </CardTitle>
          <CardDescription>
            {data?.trayAvailable
              ? t("desktop.trayReady")
              : t("desktop.trayUnavailable")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="text-sm">{t("desktop.background")}</p>
            <p className="max-w-xl text-xs text-muted-foreground">
              {t("desktop.backgroundDescription")}
            </p>
          </div>
          <Switch
            checked={settings.runInBackground}
            disabled={
              loading || (!data?.trayAvailable && !settings.runInBackground)
            }
            onCheckedChange={(value) => update({ runInBackground: value })}
            aria-label={t("desktop.background")}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <MonitorIcon className="size-4" />
            {t("desktop.windows")}
          </CardTitle>
          <CardDescription>{t("desktop.windowsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button
            onClick={() => void openWindow()}
            disabled={loading || pending}
            data-testid="open-secondary-window"
          >
            {t("desktop.openWindow")}
          </Button>
          {data?.secondaryOpen ? (
            <Badge variant="secondary">{t("desktop.windowOpen")}</Badge>
          ) : null}
        </CardContent>
      </Card>
    </NativePage>
  );
}

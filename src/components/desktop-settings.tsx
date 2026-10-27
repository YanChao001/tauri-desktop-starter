import { useEffect, useRef, useState } from "react";
import { MonitorIcon, PowerIcon, PanelTopIcon } from "lucide-react";
import { toast } from "sonner";
import { ResourceError } from "@/components/native-page";
import { SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { useNativeResource } from "@/hooks/use-native-resource";
import {
  getDesktopStatus,
  getAutostartEnabled,
  setAutostartEnabled,
  openSecondaryWindow,
  isTauri,
} from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
async function loadDesktop() {
  const status = await getDesktopStatus();
  const autostart = status.autostartSupported
    ? await getAutostartEnabled()
    : false;
  return { ...status, autostart };
}
export function DesktopSettings() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const { settings, update } = useSettings();
  const native = isTauri();
  const { data, error, loading, reload } = useNativeResource(loadDesktop);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const notifiedError = useRef<unknown>(null);
  useEffect(() => {
    if (!error) notifiedError.current = null;
    else if (data && notifiedError.current !== error) {
      notifiedError.current = error;
      toast.error(nativeErrorText(error, latest));
    }
  }, [data, error, latest]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function changeAutostart(enabled: boolean) {
    if (!native || running.current) return;
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
    if (!native || running.current) return;
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
    <section
      id="settings-desktop"
      tabIndex={-1}
      aria-label={t("desktop.settingsTitle")}
      className="space-y-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ResourceError error={data ? null : error} retry={() => void reload()} />
      {!native ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("desktop.browserOnly")}
        </p>
      ) : null}
      <div className="divide-y">
        <SettingRow
          id="settings-autostart"
          icon={PowerIcon}
          label={t("desktop.autostart")}
          hint={t("desktop.autostartDescription")}
          helpLabel={`${t("desktop.autostart")} · ${t("title.help")}`}
        >
          <Switch
            checked={data?.autostart ?? false}
            disabled={
              !native || loading || pending || !data?.autostartSupported
            }
            onCheckedChange={(value) => void changeAutostart(value)}
            aria-label={t("desktop.autostart")}
          />
        </SettingRow>
        <SettingRow
          id="settings-background"
          icon={PanelTopIcon}
          label={t("desktop.background")}
          helpLabel={`${t("desktop.background")} · ${t("title.help")}`}
          hint={
            <>
              {t("desktop.backgroundDescription")}
              <br />
              {data?.trayAvailable
                ? t("desktop.trayReady")
                : t("desktop.trayUnavailable")}
            </>
          }
        >
          <Switch
            checked={settings.runInBackground}
            disabled={
              !native ||
              loading ||
              (!data?.trayAvailable && !settings.runInBackground)
            }
            onCheckedChange={(value) => {
              if (native) update({ runInBackground: value });
            }}
            aria-label={t("desktop.background")}
          />
        </SettingRow>
        <SettingRow
          id="settings-windows"
          icon={MonitorIcon}
          label={t("desktop.windows")}
          helpLabel={`${t("desktop.windows")} · ${t("title.help")}`}
          hint={
            <>
              {t("desktop.windowsDescription")}
              {data?.secondaryOpen ? (
                <>
                  <br />
                  {t("desktop.windowOpen")}
                </>
              ) : null}
            </>
          }
        >
          <Button
            onClick={() => void openWindow()}
            disabled={!native || loading || pending}
            data-testid="open-secondary-window"
          >
            {t("desktop.openWindow")}
          </Button>
        </SettingRow>
      </div>
    </section>
  );
}

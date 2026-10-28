import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NativePage } from "@/components/native-page";
import { HelpTooltip } from "@/components/help-tooltip";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
import { nativeErrorText } from "@/lib/native-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/providers/i18n";
import { APP_CONFIG } from "@/config/app";
import { reportClientError } from "@/lib/report-error";
import {
  getActivationSnapshot,
  isTauri,
  onActivation,
  openNotesWindow,
  readSystemClipboard,
  registerGlobalShortcut,
  restoreWorkspace,
  sendSystemNotification,
  writeSystemClipboard,
  type Activation,
} from "@/lib/tauri";

export default function System() {
  const { t } = useI18n();
  const latest = useLatestTranslator();
  const [text, setText] = useState(APP_CONFIG.name);
  const [shortcut, setShortcut] = useState("CommandOrControl+Shift+Space");
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<Activation[]>([]);
  const unregister = useRef<(() => Promise<void>) | null>(null);
  const alive = useRef(true);
  const running = useRef(false);
  const deepLink = `${APP_CONFIG.integration.deepLinkScheme}://open?route=/database`;
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    if (isTauri()) {
      void onActivation((value) => {
        if (disposed) return;
        setEvents((current) =>
          [...current.filter((v) => v.id !== value.id), value]
            .sort((a, b) => a.id - b.id)
            .slice(-20),
        );
      })
        .then(async (unsubscribe) => {
          if (disposed) {
            unsubscribe();
            return;
          }
          stop = unsubscribe;
          // 订阅就绪后再读取历史，覆盖订阅注册期间发生的激活。
          const value = await getActivationSnapshot();
          if (!disposed)
            setEvents((current) =>
              [
                ...new Map(
                  [...value, ...current].map((v) => [v.id, v]),
                ).values(),
              ]
                .sort((a, b) => a.id - b.id)
                .slice(-20),
            );
        })
        .catch((reason: unknown) => {
          if (!disposed) toast.error(nativeErrorText(reason, latest));
        });
    }
    return () => {
      disposed = true;
      alive.current = false;
      stop?.();
      void unregister.current?.().catch(reportClientError);
      unregister.current = null;
    };
  }, [latest]);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
      if (alive.current) toast.success(latest("system.success"));
    } catch (reason) {
      if (alive.current) toast.error(nativeErrorText(reason, latest));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <NativePage title={t("system.title")} description={t("system.description")}>
      <div className="space-y-4">
        <section className="divide-y rounded-xl border app-surface px-4">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <h2 className="flex items-center gap-2 font-semibold">
              {t("system.notification")}
              <HelpTooltip
                label={`${t("system.notification")} · ${t("title.help")}`}
              >
                {t("system.permission")}
              </HelpTooltip>
            </h2>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !(await sendSystemNotification(
                      t("system.title"),
                      t("system.notificationBody"),
                    ))
                  )
                    throw new Error(t("system.denied"));
                })
              }
            >
              {t("system.notification")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <h2 className="flex items-center gap-2 font-semibold">
              {t("system.shortcut")}
              <HelpTooltip
                label={`${t("system.shortcut")} · ${t("title.help")}`}
              >
                {t("system.shortcutHelp")}
              </HelpTooltip>
            </h2>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Select
                value={shortcut}
                disabled={registered || busy}
                onValueChange={setShortcut}
              >
                <SelectTrigger
                  className="max-w-full"
                  aria-label={t("system.shortcut")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {[
                    "CommandOrControl+Shift+Space",
                    "CommandOrControl+Shift+Y",
                    "Alt+Shift+Y",
                  ].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (unregister.current) {
                      await unregister.current();
                      unregister.current = null;
                      setRegistered(false);
                    } else {
                      const stop = await registerGlobalShortcut(shortcut);
                      if (!alive.current) {
                        await stop();
                        return;
                      }
                      unregister.current = stop;
                      setRegistered(true);
                    }
                  })
                }
              >
                {t(registered ? "system.unregister" : "system.register")}
              </Button>
            </div>
          </div>
          <div className="space-y-2 py-3">
            <Label htmlFor="system-clipboard">{t("system.clipboard")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="system-clipboard"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={16000}
                className="min-w-40 flex-1"
              />
              <Button
                disabled={busy}
                onClick={() => void run(() => writeSystemClipboard(text))}
              >
                {t("system.writeClipboard")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setText((await readSystemClipboard()).slice(0, 16000)),
                  )
                }
              >
                {t("system.readClipboard")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <h2 className="font-semibold">{t("system.workspace")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={() => void run(openNotesWindow)}>
                {t("system.window")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(restoreWorkspace)}
              >
                {t("system.restore")}
              </Button>
            </div>
          </div>
        </section>
        <section className="space-y-3 rounded-xl border app-surface p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            {t("system.deepLink")}
            <HelpTooltip label={`${t("system.deepLink")} · ${t("title.help")}`}>
              {t("system.deepLinkHelp", {
                deepLink,
                extension: APP_CONFIG.integration.fileExtension,
              })}
            </HelpTooltip>
          </h2>
          <code
            data-surface="reading"
            className="block select-text break-all rounded p-3 text-xs"
          >
            {deepLink}
          </code>
          <h3 className="text-sm font-medium">{t("system.events")}</h3>
          <ul
            className="h-24 space-y-2 overflow-auto text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-live="polite"
            aria-label={t("system.events")}
            tabIndex={0}
          >
            {events.length ? (
              events.map((event) => (
                <li key={event.id} className="break-all rounded border p-2">
                  #{event.id} · {event.source} · {event.route}{" "}
                  {event.files.join(", ")}
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">{t("system.empty")}</li>
            )}
          </ul>
        </section>
      </div>
    </NativePage>
  );
}

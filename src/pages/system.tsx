import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NativePage, ResourceError } from "@/components/native-page";
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
  const [text, setText] = useState("Tauri Desktop Starter");
  const [shortcut, setShortcut] = useState("CommandOrControl+Shift+Space");
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [events, setEvents] = useState<Activation[]>([]);
  const unregister = useRef<(() => Promise<void>) | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    if (isTauri()) {
      void onActivation((value) =>
        setEvents((current) =>
          [...current.filter((v) => v.id !== value.id), value].slice(-20),
        ),
      )
        .then((value) => {
          if (disposed) value();
          else stop = value;
        })
        .catch(setError);
      void getActivationSnapshot()
        .then((value) => {
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
        .catch(setError);
    }
    return () => {
      disposed = true;
      alive.current = false;
      stop?.();
      void unregister.current?.();
      unregister.current = null;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (alive.current) toast.success(t("system.success"));
    } catch (reason) {
      if (alive.current) setError(reason);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <NativePage title={t("system.title")} description={t("system.description")}>
      <div className="space-y-5">
        <ResourceError error={error} retry={() => setError(null)} />
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("system.notification")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("system.permission")}
          </p>
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
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("system.shortcut")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("system.shortcutHelp")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Select
              value={shortcut}
              disabled={registered || busy}
              onValueChange={setShortcut}
            >
              <SelectTrigger aria-label={t("system.shortcut")}>
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
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <Label htmlFor="system-clipboard">{t("system.clipboard")}</Label>
          <Input
            id="system-clipboard"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={16000}
          />
          <div className="flex flex-wrap gap-2">
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
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("system.deepLink")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("system.deepLinkHelp")}
          </p>
          <code className="block select-text break-all rounded bg-muted p-3 text-xs">
            tdemo://open?route=/database
          </code>
          <h3 className="text-sm font-medium">{t("system.events")}</h3>
          <ul className="space-y-2 text-sm" aria-live="polite">
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
        <div className="flex flex-wrap gap-2">
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
    </NativePage>
  );
}

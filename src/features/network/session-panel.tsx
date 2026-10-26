import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/providers/i18n";
import {
  deleteDemoCredential,
  getDemoCredential,
  isTauri,
  setDemoCredential,
} from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";

export function SessionPanel() {
  const { t } = useI18n();
  const [name, setName] = useState("Ada");
  const [session, setSession] = useState<{
    name: string;
    expires: number;
  } | null>(null);
  const [now, setNow] = useState(Date.now);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (time >= session.expires) {
        setSession(null);
        setExpired(true);
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.session.title")}
          <HelpTooltip
            label={`${t("labs.session.title")} · ${t("title.help")}`}
          >
            {t("labs.session.hint")}
          </HelpTooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            const time = Date.now();
            setNow(time);
            setExpired(false);
            setSession({ name: name.trim(), expires: time + 30000 });
          }}
        >
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="session-name">{t("labs.session.name")}</Label>
            <Input
              id="session-name"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button disabled={!name.trim()}>{t("labs.session.signIn")}</Button>
        </form>
        <p
          role="status"
          className="h-12 truncate rounded-md bg-muted p-3 text-sm"
        >
          {session
            ? t("labs.session.active", {
                name: session.name,
                seconds: Math.max(0, Math.ceil((session.expires - now) / 1000)),
              })
            : t(expired ? "labs.session.expired" : "labs.session.guest")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!session}
            onClick={() => {
              setSession(null);
              setExpired(true);
            }}
          >
            {t("labs.session.expire")}
          </Button>
          <Button
            variant="outline"
            disabled={!session && !expired}
            onClick={() => {
              setSession(null);
              setExpired(false);
            }}
          >
            {t("labs.session.signOut")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CredentialPanel() {
  const { t } = useI18n();
  const native = isTauri();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(action: "save" | "read" | "delete") {
    if (!native || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      let result: "saved" | "present" | "empty" | "deleted";
      if (action === "save") {
        await setDemoCredential(value);
        result = "saved";
      } else if (action === "read")
        result = (await getDemoCredential()) === null ? "empty" : "present";
      else {
        await deleteDemoCredential();
        result = "deleted";
      }
      if (mounted.current) {
        setValue("");
        toast.success(t(`labs.credential.${result}`));
      }
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, t));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.credential.title")}
          <HelpTooltip
            label={`${t("labs.credential.title")} · ${t("title.help")}`}
          >
            {t("labs.credential.hint")}
          </HelpTooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" aria-busy={pending}>
        {!native ? (
          <p className="text-sm text-muted-foreground">
            {t("labs.desktopRequired")}
          </p>
        ) : null}
        <Label htmlFor="demo-credential">{t("labs.credential.value")}</Label>
        <Input
          id="demo-credential"
          type="password"
          autoComplete="off"
          maxLength={1000}
          disabled={!native || pending}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!native || pending || !value.trim()}
            onClick={() => void run("save")}
          >
            {t("labs.credential.save")}
          </Button>
          <Button
            variant="outline"
            disabled={!native || pending}
            onClick={() => void run("read")}
          >
            {t("labs.credential.read")}
          </Button>
          <Button
            variant="outline"
            disabled={!native || pending}
            onClick={() => void run("delete")}
          >
            {t("labs.credential.delete")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

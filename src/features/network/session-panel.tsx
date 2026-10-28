import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/help-tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n";
import { useLatestTranslator } from "@/hooks/use-latest-translator";
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
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted p-3 text-sm">
          {session ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="min-w-0 flex-1 basis-32 truncate rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {session.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="max-w-72 break-words"
                  >
                    {session.name}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span
                role="timer"
                aria-live="off"
                className="shrink-0 tabular-nums"
              >
                {t("labs.session.remaining", {
                  seconds: Math.max(
                    0,
                    Math.ceil((session.expires - now) / 1000),
                  ),
                })}
              </span>
            </>
          ) : (
            <span aria-hidden="true">
              {t(expired ? "labs.session.expired" : "labs.session.guest")}
            </span>
          )}
        </div>
        <p role="status" className="sr-only">
          {session
            ? t("labs.session.signedIn", { name: session.name })
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
  const latest = useLatestTranslator();
  const native = isTauri();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
        if (action === "delete") setConfirmingDelete(false);
        toast.success(latest(`labs.credential.${result}`));
      }
    } catch (reason) {
      if (mounted.current) toast.error(nativeErrorText(reason, latest));
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
        <div className="space-y-1.5">
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
        </div>
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
          <Dialog
            open={confirmingDelete}
            onOpenChange={(open) => {
              if (!busy.current) setConfirmingDelete(open);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={!native || pending}>
                {t("labs.credential.delete")}
              </Button>
            </DialogTrigger>
            <DialogContent closeLabel={t("common.close")} aria-busy={pending}>
              <DialogHeader>
                <DialogTitle>{t("labs.credential.deleteTitle")}</DialogTitle>
                <DialogDescription>
                  {t("labs.credential.deleteHint")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => void run("delete")}
                >
                  {t("labs.credential.delete")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}

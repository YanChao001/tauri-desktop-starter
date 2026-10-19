import type { ReactNode } from "react";
import { AlertCircleIcon, MonitorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/providers/i18n";
import { isTauri } from "@/lib/tauri";
import { nativeErrorText } from "@/lib/native-error";
export function NativePage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {isTauri() ? (
        children
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <MonitorIcon className="size-5 shrink-0 text-muted-foreground" />
            <p className="text-sm">{t("common.nativeRequired")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export function ResourceError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-background p-3 text-sm"
    >
      <span className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 shrink-0 text-destructive" />
        {nativeErrorText(error, t)}
      </span>
      <Button size="sm" variant="outline" onClick={retry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

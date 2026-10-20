import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import type { Note } from "@/lib/tauri";

type Props = {
  remote: Note | null;
  pending: boolean;
  keepLocal: () => void;
  saveCopy: () => void;
};

export function ConflictPanel({ remote, pending, keepLocal, saveCopy }: Props) {
  const { t } = useI18n();
  return (
    <section
      className="space-y-3 rounded-lg border border-amber-500/50 bg-background p-4"
      aria-label={t("data.conflict")}
    >
      <h3 className="font-medium">{t("data.conflict")}</h3>
      <p className="text-sm text-muted-foreground">{t("data.conflictHint")}</p>
      {remote ? (
        <details>
          <summary className="cursor-pointer text-sm">
            {t("data.viewRemote")}
          </summary>
          <h4 className="mt-2 font-medium">{remote.title}</h4>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">
            {remote.body}
          </pre>
        </details>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("data.remoteUnavailable")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {remote ? (
          <Button variant="outline" disabled={pending} onClick={keepLocal}>
            {t("data.keepLocal")}
          </Button>
        ) : null}
        <Button disabled={pending} onClick={saveCopy}>
          {t("data.saveCopy")}
        </Button>
      </div>
    </section>
  );
}

import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/help-tooltip";
import { useId, useState } from "react";
import { TextDiff } from "@/components/text-diff";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/providers/i18n";
import type { Note } from "@/lib/tauri";

type Props = {
  local: { title: string; body: string };
  remote: Note | null;
  pending: boolean;
  keepLocal: () => void;
  saveCopy: () => void;
  merge: (value: { title: string; body: string }) => void;
};

export function ConflictPanel({
  local,
  remote,
  pending,
  keepLocal,
  saveCopy,
  merge,
}: Props) {
  const { t } = useI18n();
  const id = useId();
  const revision = `${remote?.id}:${remote?.version}`;
  const [titleSelection, setTitleSelection] = useState({
    revision,
    choice: "local",
  });
  const titleChoice =
    titleSelection.revision === revision ? titleSelection.choice : "local";
  return (
    <section
      className="space-y-3 rounded-lg border border-amber-500/50 bg-background p-4"
      aria-label={t("data.conflict")}
    >
      <div className="flex items-center gap-2">
        <h3 className="font-medium">{t("data.conflict")}</h3>
        <HelpTooltip label={`${t("data.conflict")} · ${t("title.help")}`}>
          {t("data.conflictHint")}
        </HelpTooltip>
      </div>
      {remote ? (
        <>
          <RadioGroup
            aria-label={t("diff.titleChoice")}
            value={titleChoice}
            onValueChange={(choice) => setTitleSelection({ revision, choice })}
            disabled={pending}
          >
            <Label htmlFor={`${id}-local`} className="min-w-0">
              <RadioGroupItem id={`${id}-local`} value="local" />
              <span className="min-w-0 truncate" title={local.title}>
                {t("diff.keepTitle")}: {local.title}
              </span>
            </Label>
            <Label htmlFor={`${id}-remote`} className="min-w-0">
              <RadioGroupItem id={`${id}-remote`} value="remote" />
              <span className="min-w-0 truncate" title={remote.title}>
                {t("diff.remoteTitle")}: {remote.title}
              </span>
            </Label>
          </RadioGroup>
          <TextDiff
            local={local.body}
            remote={remote.body}
            disabled={pending}
            onApply={(body) =>
              merge({
                title: titleChoice === "remote" ? remote.title : local.title,
                body,
              })
            }
          />
        </>
      ) : null}
      {remote ? (
        <details>
          <summary className="cursor-pointer text-sm">
            {t("data.viewRemote")}
          </summary>
          <h4 className="mt-2 truncate font-medium" title={remote.title}>
            {remote.title}
          </h4>
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

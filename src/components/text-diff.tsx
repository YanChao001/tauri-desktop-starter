import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/help-tooltip";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/providers/i18n";
import { mergeTextDiff, textDiff, type DiffChoices } from "@/lib/text-diff";

export function TextDiff({
  local,
  remote,
  disabled = false,
  onApply,
}: {
  local: string;
  remote: string;
  disabled?: boolean;
  onApply: (text: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const blocks = useMemo(() => textDiff(local, remote), [local, remote]);
  const [selection, setSelection] = useState<{
    local: string;
    remote: string;
    choices: DiffChoices;
  }>({ local, remote, choices: {} });
  const choices =
    selection.local === local && selection.remote === remote
      ? selection.choices
      : {};
  const changes = blocks.filter((block) => block.changed).length;
  const preview = (value: string[], changed: boolean) => {
    const limit = changed ? 40 : 3;
    const text = value.slice(0, limit).join("\n");
    const displayed = text.slice(0, 6000).replace(/[\uD800-\uDBFF]$/, "");
    return (
      (displayed || t("diff.empty")) +
      (value.length > limit
        ? "\n" + t("diff.omitted", { count: value.length - limit })
        : "") +
      (text.length > 6000 ? "\n" + t("diff.shortened") : "")
    );
  };
  return (
    <section className="space-y-3" aria-label={t("diff.title")}>
      <div className="flex h-6 min-w-0 items-center gap-2">
        <h4 className="min-w-0 truncate text-sm font-medium tabular-nums">
          {t("diff.title")} · {t("diff.count", { count: changes })}
        </h4>
        <HelpTooltip label={`${t("diff.title")} · ${t("title.help")}`}>
          {t("diff.hint")}
        </HelpTooltip>
      </div>
      <div
        className="max-h-[28rem] space-y-3 overflow-auto rounded-md border p-3"
        tabIndex={0}
        role="region"
        aria-label={t("diff.blocks")}
      >
        {blocks.map((block) => (
          <div key={block.id} className="space-y-2">
            {block.changed ? (
              <RadioGroup
                value={choices[block.id] ?? "local"}
                disabled={disabled}
                className="flex flex-wrap gap-4"
                aria-label={t("diff.change", { number: block.id + 1 })}
                onValueChange={(value) => {
                  if (value === "local" || value === "remote")
                    setSelection({
                      local,
                      remote,
                      choices: { ...choices, [block.id]: value },
                    });
                }}
              >
                <Label htmlFor={`${id}-${block.id}-local`}>
                  <RadioGroupItem
                    id={`${id}-${block.id}-local`}
                    value="local"
                  />
                  {t("diff.local")}
                </Label>
                <Label htmlFor={`${id}-${block.id}-remote`}>
                  <RadioGroupItem
                    id={`${id}-${block.id}-remote`}
                    value="remote"
                  />
                  {t("diff.remote")}
                </Label>
              </RadioGroup>
            ) : null}
            <div className="grid gap-2 md:grid-cols-2">
              {(["local", "remote"] as const).map((side) => (
                <div
                  key={side}
                  data-surface="reading"
                  className={`min-w-0 rounded-md border p-2 ${block.changed ? (side === "local" ? "border-destructive/30" : "border-primary/30") : "text-muted-foreground"}`}
                >
                  <span className="text-xs font-medium">
                    {t(side === "local" ? "diff.local" : "diff.remote")}
                  </span>
                  <pre
                    data-surface="transparent"
                    className="mt-1 whitespace-pre-wrap break-all text-xs"
                  >
                    {preview(block[side], block.changed)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!blocks.length ? <p className="text-sm">{t("diff.empty")}</p> : null}
      </div>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => onApply(mergeTextDiff(blocks, choices))}
      >
        {t("diff.apply")}
      </Button>
    </section>
  );
}

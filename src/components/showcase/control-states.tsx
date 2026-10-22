import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/providers/i18n";

const OPTIONS = ["playground.optionDesign", "playground.optionCode"] as const;

export function ControlStates() {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [checked, setChecked] = useState(false);
  const [selection, setSelection] = useState<readonly boolean[]>([true, false]);
  const invalid = checked && !title.trim();
  const all = selection.every(Boolean);
  function validate(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
  }
  return (
    <div className="control-states">
      <form className="space-y-4" onSubmit={validate} noValidate>
        <div className="space-y-2">
          <Label htmlFor="reference-title">
            {t("playground.requiredTitle")}
          </Label>
          <Input
            id="reference-title"
            required
            maxLength={60}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setChecked(false);
            }}
            aria-invalid={invalid}
            aria-describedby={invalid ? "reference-title-error" : undefined}
          />
          {invalid ? (
            <p
              id="reference-title-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {t("playground.titleRequired")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="reference-notes">{t("playground.notes")}</Label>
          <Textarea
            id="reference-notes"
            rows={3}
            maxLength={240}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-describedby="reference-notes-count"
          />
          <p
            id="reference-notes-count"
            className="text-xs text-muted-foreground"
          >
            {t("playground.characterCount", { count: notes.length, max: 240 })}
          </p>
        </div>
        <Button type="submit" variant="outline">
          {t("playground.validate")}
        </Button>
        {checked && !invalid ? (
          <p role="status" className="text-sm">
            {t("playground.validated")}
          </p>
        ) : null}
      </form>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reference-readonly">{t("playground.readOnly")}</Label>
          <Input
            id="reference-readonly"
            readOnly
            value={t("playground.sampleValue")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reference-disabled">{t("playground.disabled")}</Label>
          <Input
            id="reference-disabled"
            disabled
            value={t("playground.sampleValue")}
          />
        </div>
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium">
            {t("playground.mixedSelection")}
          </legend>
          <Label>
            <Checkbox
              checked={
                all ? true : selection.some(Boolean) ? "indeterminate" : false
              }
              onCheckedChange={(value) =>
                setSelection(OPTIONS.map(() => value === true))
              }
            />
            {t("playground.selectAll")}
          </Label>
          <div className="space-y-3 pl-6">
            {OPTIONS.map((option, index) => (
              <Label key={option}>
                <Checkbox
                  checked={selection[index]}
                  onCheckedChange={(value) =>
                    setSelection((current) =>
                      current.map((item, at) =>
                        at === index ? value === true : item,
                      ),
                    )
                  }
                />
                {t(option)}
              </Label>
            ))}
          </div>
          <Label>
            <Checkbox disabled />
            {t("playground.disabledChoice")}
          </Label>
        </fieldset>
        <Button disabled>{t("playground.disabledAction")}</Button>
      </div>
    </div>
  );
}

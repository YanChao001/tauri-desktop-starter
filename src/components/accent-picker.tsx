import { useId, useRef, useState } from "react";
import { CheckIcon, PaletteIcon } from "lucide-react";
import { SettingLabel } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRESET_ACCENTS, normalizeAccentColor } from "@/lib/accent-colors";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";

export function AccentPicker() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const id = useId();
  const hexInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings.customAccent);
  const [attempted, setAttempted] = useState(false);
  const normalized = normalizeAccentColor(draft);
  const invalid = attempted && normalized === null;

  return (
    <div
      id="settings-accent"
      tabIndex={-1}
      className="space-y-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SettingLabel
        icon={PaletteIcon}
        label={t("settings.accent")}
        hint={t("settings.customAccentHint")}
        helpLabel={`${t("settings.accent")} · ${t("title.help")}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        {PRESET_ACCENTS.map((accent) => {
          const active = settings.accent === accent;
          return (
            <button
              data-surface="artwork"
              key={accent}
              type="button"
              aria-label={t(`settings.color.${accent}`)}
              title={t(`settings.color.${accent}`)}
              aria-pressed={active}
              onClick={() => update({ accent })}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: `var(--accent-swatch-${accent})` }}
            >
              {active ? (
                <span className="grid size-4 place-items-center rounded-full bg-foreground text-background">
                  <CheckIcon className="size-3" aria-hidden="true" />
                </span>
              ) : null}
            </button>
          );
        })}
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (next) {
              // 一次打开只建立一个草稿，晚到的跨窗口设置不覆盖正在输入的内容。
              setDraft(settings.customAccent);
              setAttempted(false);
            }
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={settings.accent === "custom"}
              className={cn(
                "ml-auto",
                settings.accent === "custom" && "border-primary",
              )}
            >
              <span
                aria-hidden="true"
                data-surface="artwork"
                className="size-4 rounded-full border"
                style={{ backgroundColor: settings.customAccent }}
              />
              {t("settings.color.custom")}
              {settings.accent === "custom" ? (
                <CheckIcon className="size-3.5" aria-hidden="true" />
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={12}
            aria-label={t("settings.customAccent")}
            className="w-72 max-w-[calc(100vw-2rem)]"
          >
            <form
              className="space-y-3"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (!normalized) {
                  setAttempted(true);
                  hexInput.current?.focus();
                  return;
                }
                update({ accent: "custom", customAccent: normalized });
                setOpen(false);
              }}
            >
              <div className="flex items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-picker`}>
                    {t("settings.customAccentPicker")}
                  </Label>
                  <Input
                    id={`${id}-picker`}
                    type="color"
                    value={normalized ?? settings.customAccent}
                    onChange={(event) => setDraft(event.target.value)}
                    className="h-9 w-full min-w-16 cursor-pointer p-1"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={`${id}-hex`}>
                    {t("settings.customAccentHex")}
                  </Label>
                  <Input
                    ref={hexInput}
                    id={`${id}-hex`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `${id}-error` : undefined}
                    className="h-9 font-mono"
                  />
                </div>
              </div>
              {invalid ? (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {t("settings.customAccentInvalid")}
                </p>
              ) : null}
              <Button type="submit" className="w-full">
                {t("settings.customAccentApply")}
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

import { CheckIcon } from "lucide-react";
import { PatternArtwork } from "@/components/window-background";
import { CustomBackgroundPicker } from "@/components/custom-background-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BUILTIN_BACKGROUNDS,
  BACKGROUND_METADATA,
  BACKGROUND_INTENSITIES,
  DEFAULT_BACKGROUND_INTENSITY,
  normalizeBackgroundIntensity,
} from "@/lib/backgrounds";
import { cn } from "@/lib/utils";
import { useI18n } from "@/providers/i18n";
import { useSettings } from "@/providers/settings";

/** 缩略图与窗口复用同一份矢量插画，切换即生效。 */
export function SkinPicker() {
  const { t } = useI18n();
  const { settings, update } = useSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle id="skin-gallery-heading" className="text-sm">
          {t("settings.skinGallery")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <TooltipProvider delayDuration={650} skipDelayDuration={0}>
          <fieldset
            className="skin-gallery"
            aria-labelledby="skin-gallery-heading"
          >
            {BUILTIN_BACKGROUNDS.map((kind) => {
              const metadata = BACKGROUND_METADATA[kind];
              const active = settings.background === kind;
              const descriptionId = `skin-${kind}-description`;
              return (
                <Tooltip key={kind}>
                  <TooltipTrigger asChild>
                    <label
                      className={cn(
                        "skin-gallery-card group relative cursor-pointer rounded-xl border p-2 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border/70 bg-background/25 hover:border-primary/50 hover:bg-background/45",
                      )}
                    >
                      <input
                        type="radio"
                        name="background-skin"
                        className="sr-only"
                        value={kind}
                        checked={active}
                        aria-label={t(metadata.labelKey)}
                        aria-describedby={descriptionId}
                        onChange={() => update({ background: kind })}
                      />
                      <span className="relative block aspect-[1.6] overflow-hidden rounded-lg border border-foreground/8 bg-background">
                        <PatternArtwork
                          kind={kind}
                          preview
                          className="absolute inset-0 size-full"
                        />
                        <span
                          className="absolute left-2 top-2 flex gap-1"
                          aria-hidden="true"
                        >
                          <span className="size-1 rounded-full bg-foreground/20" />
                          <span className="size-1 rounded-full bg-foreground/15" />
                          <span className="size-1 rounded-full bg-foreground/10" />
                        </span>
                        {active ? (
                          <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                            <CheckIcon className="size-3" aria-hidden="true" />
                            <span className="sr-only">
                              {t("settings.activeSkin")}
                            </span>
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2 block px-0.5 text-xs font-medium">
                        {t(metadata.labelKey)}
                      </span>
                      <span id={descriptionId} className="sr-only">
                        {t(metadata.descriptionKey)}
                      </span>
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64">
                    {t(metadata.descriptionKey)}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </fieldset>
        </TooltipProvider>

        <CustomBackgroundPicker />

        <fieldset
          id="settings-backgroundIntensity"
          tabIndex={-1}
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <Label id="skin-intensity-heading" className="text-xs">
              {t("settings.backgroundIntensity")}
            </Label>
          </div>
          <div className="ml-auto w-full max-w-80 space-y-1">
            <div
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              aria-hidden="true"
            >
              <span>{t("settings.intensityCovered")}</span>
              <output className="text-foreground tabular-nums">
                {settings.backgroundIntensity}%
              </output>
              <span>{t("settings.intensityTransparent")}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={10}
              value={[settings.backgroundIntensity]}
              disabled={settings.background === "plain"}
              aria-labelledby="skin-intensity-heading"
              aria-valuetext={t("settings.intensityValue", {
                value: settings.backgroundIntensity,
                level: settings.backgroundIntensity / 10 + 1,
              })}
              onValueChange={([value]) => {
                if (value !== undefined)
                  update({
                    backgroundIntensity: normalizeBackgroundIntensity(value),
                  });
              }}
              className="min-h-5"
            />
            <div className="flex justify-between px-1.5" aria-hidden="true">
              {BACKGROUND_INTENSITIES.map((intensity) => (
                <span
                  key={intensity}
                  className={cn(
                    "h-1 w-px bg-muted-foreground/40",
                    intensity === DEFAULT_BACKGROUND_INTENSITY &&
                      "h-2 bg-primary",
                  )}
                />
              ))}
            </div>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

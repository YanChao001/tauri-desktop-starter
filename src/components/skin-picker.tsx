import { CheckIcon, SparklesIcon } from "lucide-react";
import { PatternArtwork } from "@/components/window-background";
import { CustomBackgroundPicker } from "@/components/custom-background-picker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  BUILTIN_BACKGROUNDS,
  BACKGROUND_METADATA,
  BACKGROUND_INTENSITIES,
  BACKGROUND_INTENSITY_METADATA,
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
        <div className="flex items-center justify-between gap-3">
          <CardTitle id="skin-gallery-heading" className="text-sm">
            {t("settings.skinGallery")}
          </CardTitle>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <SparklesIcon className="size-3.5" aria-hidden="true" />
            {t("settings.skinLightweight")}
          </span>
        </div>
        <CardDescription className="text-xs">
          {t("settings.skinGalleryDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset
          className="skin-gallery"
          aria-labelledby="skin-gallery-heading"
        >
          {BUILTIN_BACKGROUNDS.map((kind) => {
            const metadata = BACKGROUND_METADATA[kind];
            const active = settings.background === kind;
            const descriptionId = `skin-${kind}-description`;
            return (
              <label
                key={kind}
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
                <span
                  id={descriptionId}
                  className="mt-1 block px-0.5 pb-0.5 text-[11px] leading-relaxed text-muted-foreground"
                >
                  {t(metadata.descriptionKey)}
                </span>
              </label>
            );
          })}
        </fieldset>

        <CustomBackgroundPicker />

        <fieldset
          id="settings-backgroundIntensity"
          tabIndex={-1}
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
          disabled={settings.background === "plain"}
        >
          <div className="space-y-1">
            <Label id="skin-intensity-heading" className="text-xs">
              {t("settings.backgroundIntensity")}
            </Label>
            <p className="text-[11px] text-muted-foreground">
              {t("settings.backgroundIntensityDescription")}
            </p>
          </div>
          <div
            className="flex gap-1 rounded-lg bg-muted/55 p-1"
            role="radiogroup"
            aria-labelledby="skin-intensity-heading"
          >
            {BACKGROUND_INTENSITIES.map((intensity) => (
              <label
                key={intensity}
                className="cursor-pointer has-disabled:cursor-default"
              >
                <input
                  type="radio"
                  name="background-intensity"
                  className="peer sr-only"
                  checked={settings.backgroundIntensity === intensity}
                  value={intensity}
                  onChange={() => update({ backgroundIntensity: intensity })}
                />
                <span className="block rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors peer-checked:bg-background peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-40">
                  {t(BACKGROUND_INTENSITY_METADATA[intensity].labelKey)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

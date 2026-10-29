import { useId, type CSSProperties } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { HslColor } from "@/lib/color-picker-model";
import { useI18n } from "@/providers/i18n";

type ColorPickerProps = {
  value: HslColor;
  onValueChange: (value: HslColor) => void;
};

/** 复用应用滑条的键盘与指针交互，颜色渐变只影响本控件的轨道。 */
export function ColorPicker({ value, onValueChange }: ColorPickerProps) {
  const { t } = useI18n();
  const id = useId();
  const tracks = [
    {
      key: "hue",
      label: "settings.customAccentHue",
      max: 360,
      suffix: "°",
      gradient:
        "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
    },
    {
      key: "saturation",
      label: "settings.customAccentSaturation",
      max: 100,
      suffix: "%",
      gradient: `linear-gradient(to right, hsl(${value.hue} 0% ${value.lightness}%), hsl(${value.hue} 100% ${value.lightness}%))`,
    },
    {
      key: "lightness",
      label: "settings.customAccentLightness",
      max: 100,
      suffix: "%",
      gradient: `linear-gradient(to right, #000, hsl(${value.hue} ${value.saturation}% 50%), #fff)`,
    },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("settings.customAccentPicker")}
      className="space-y-2"
    >
      {tracks.map((track) => (
        <div key={track.key} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label id={`${id}-${track.key}`}>{t(track.label)}</Label>
            <span
              aria-hidden="true"
              className="text-xs text-muted-foreground tabular-nums"
            >
              {Math.round(value[track.key])}
              {track.suffix}
            </span>
          </div>
          <Slider
            data-surface="artwork"
            min={0}
            max={track.max}
            step={1}
            value={[value[track.key]]}
            aria-labelledby={`${id}-${track.key}`}
            aria-valuetext={`${Math.round(value[track.key])}${track.suffix}`}
            onValueChange={([next]) => {
              if (next !== undefined)
                onValueChange({ ...value, [track.key]: next });
            }}
            style={
              { "--color-picker-gradient": track.gradient } as CSSProperties
            }
            className="min-h-5 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-[image:var(--color-picker-gradient)] [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:border-foreground [&_[data-slot=slider-thumb]]:ring-1 [&_[data-slot=slider-thumb]]:ring-background [&_[data-slot=slider-thumb]:focus-visible]:outline-2 [&_[data-slot=slider-thumb]:focus-visible]:outline-ring [&_[data-slot=slider-thumb]:focus-visible]:outline-offset-2"
          />
        </div>
      ))}
    </div>
  );
}

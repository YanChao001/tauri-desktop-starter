import { useId, type ReactNode, type RefObject } from "react";
import { useI18n } from "@/providers/i18n";
export type SceneProps = {
  active: boolean;
  reduced: boolean;
  replay: number;
  stageRef: RefObject<HTMLDivElement | null>;
};
export function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  const id = useId();
  return (
    <label className="lab-range" htmlFor={id}>
      <span>
        {label}
        <output htmlFor={id}>
          {value}
          {suffix}
        </output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
export function Notes({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="lab-notes">
      <span>{t("lab.insight")}</span>
      <p>{children}</p>
    </div>
  );
}
